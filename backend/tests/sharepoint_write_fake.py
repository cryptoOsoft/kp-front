"""A WRITABLE SharePoint drive on an `httpx.MockTransport` – for the Objektbesuche delivery and
the Einsatz-Ablage.

The importer's fake (`sharepoint_fake.py`) is a read-only folder tree; the delivery needs the
four write shapes `app/object_visit_sharepoint.GraphWriter` sends, so this is a second fixture
rather than a mode of the first. It answers:

* the token endpoint, the site → drive resolution;
* `GET /drives/{d}/root` and `GET /drives/{d}/root:/{path}` (item by path, 404 when absent);
* `GET /drives/{d}/items/{id}` (item by id, wherever it was moved);
* `POST /drives/{d}/items/{id}/children` (folder create, `conflictBehavior: fail` → 409);
* `PUT /drives/{d}/root:/{path}:/content` (create/replace, `If-Match` → 412 on a stale eTag) and
  `PUT /drives/{d}/items/{folder}:/{name}:/content` (the same, into a folder known by id);
* `PATCH /drives/{d}/items/{id}` (move via `parentReference`, 409 when the name is taken);
* `GET https://storage.example/dl/{id}` (the pre-authenticated download URL).

Failure injection, the way a real tenant fails:

    drive.fail("PUT", "Fotos/", 429)       # the next matching request answers 429, nothing applied
    drive.lose("PUT", "Objektbesuch.pdf")  # applied, but the client sees a dropped connection
    drive.forbid()                         # every write answers 403 (the grant is read-only)
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qs, unquote, urlsplit

import httpx

SITE_URL = "https://feuerwehr.sharepoint.com/sites/kp"
SITE_ID = "feuerwehr.sharepoint.com,1111,2222"
DRIVE_ID = "b!export-drive"
TENANT_ID = "33333333-3333-4333-8333-333333333333"
CLIENT_ID = "44444444-4444-4444-8444-444444444444"
CLIENT_SECRET = "an-export-secret"


@dataclass
class Item:
    id: str
    path: str  # '' = drive root
    folder: bool
    data: bytes = b""
    etag: str = ""
    content_type: str = ""


@dataclass
class FakeDrive:
    """A drive keyed by path. ``seed`` paths are folders that exist before the test starts."""

    seed: list[str] = field(default_factory=list)
    items: dict[str, Item] = field(default_factory=dict)
    _n: int = 0
    auth_ok: bool = True
    writes_forbidden: bool = False
    #: [(method, path fragment, status)] — consumed by the first matching request
    failures: list[tuple[str, str, int]] = field(default_factory=list)
    #: [(method, path fragment)] — applied, then the response is lost
    losses: list[tuple[str, str]] = field(default_factory=list)
    #: (method, url) of every request, in order
    seen: list[tuple[str, str]] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.items[""] = Item(id="root", path="", folder=True)
        for path in self.seed:
            self.mkdirs(path)

    # --- driving -------------------------------------------------------------------------

    def _next_id(self) -> str:
        self._n += 1
        return f"item-{self._n}"

    def mkdirs(self, path: str) -> Item:
        current = ""
        item = self.items[""]
        for part in [p for p in path.split("/") if p]:
            current = f"{current}/{part}" if current else part
            if current not in self.items:
                self.items[current] = Item(id=self._next_id(), path=current, folder=True)
            item = self.items[current]
        return item

    def relocate(self, old: str, new: str) -> None:
        """A person moves a folder (and what is in it) – its items keep their ids."""
        self.mkdirs(new.rsplit("/", 1)[0] if "/" in new else "")
        for path in sorted(p for p in self.items if p == old or p.startswith(f"{old}/")):
            item = self.items.pop(path)
            item.path = new + path[len(old) :]
            self.items[item.path] = item

    def fail(self, method: str, fragment: str, status: int) -> None:
        self.failures.append((method, fragment, status))

    def lose(self, method: str, fragment: str) -> None:
        self.losses.append((method, fragment))

    def forbid(self) -> None:
        self.writes_forbidden = True

    def files(self, under: str = "") -> dict[str, bytes]:
        prefix = f"{under}/" if under else ""
        return {p: i.data for p, i in self.items.items() if not i.folder and p.startswith(prefix)}

    def folders(self) -> list[str]:
        return sorted(p for p, i in self.items.items() if i.folder and p)

    def json_at(self, path: str) -> dict[str, Any]:
        return json.loads(self.items[path].data)

    def by_id(self, item_id: str) -> Item | None:
        return next((i for i in self.items.values() if i.id == item_id), None)

    # --- the transport ---------------------------------------------------------------------

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    def _injected(self, method: str, path: str) -> int | None:
        for entry in self.failures:
            m, frag, status = entry
            if m == method and frag in path:
                self.failures.remove(entry)
                return status
        return None

    def _lost(self, method: str, path: str) -> bool:
        for entry in self.losses:
            m, frag = entry
            if m == method and frag in path:
                self.losses.remove(entry)
                return True
        return False

    def _handle(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        method = request.method
        self.seen.append((method, url))
        parts = urlsplit(url)
        path = unquote(parts.path)

        if path.endswith("/oauth2/v2.0/token"):
            if not self.auth_ok:
                return httpx.Response(401, json={"error": "invalid_client", "error_description": "AADSTS7000222"})
            return httpx.Response(200, json={"access_token": "w-token", "expires_in": 3600})
        if parts.netloc == "storage.example":
            item = self.by_id(path.rsplit("/", 1)[-1])
            return httpx.Response(200, content=item.data) if item else httpx.Response(404)
        if request.headers.get("authorization") != "Bearer w-token":
            return httpx.Response(401, json={"error": {"code": "InvalidAuthenticationToken"}})

        status = self._injected(method, path)
        if status is not None:
            return httpx.Response(status, json={"error": {"code": "injected", "message": f"{method} {status}"}})
        if method != "GET" and self.writes_forbidden:
            return httpx.Response(403, json={"error": {"code": "accessDenied", "message": "read-only grant"}})

        if "/sites/" in path and path.endswith("/drives"):
            return httpx.Response(200, json={"value": [{"id": DRIVE_ID, "name": "Dokumente"}]})
        if "/sites/" in path and path.endswith("/drive"):
            return httpx.Response(200, json={"id": DRIVE_ID})
        if "/sites/" in path:
            return httpx.Response(200, json={"id": SITE_ID})

        marker = f"/drives/{DRIVE_ID}/"
        if marker not in path:
            return httpx.Response(404, json={"error": {"code": "itemNotFound"}})
        rest = path.split(marker, 1)[1]

        response = self._route(method, rest, request)
        if self._lost(method, path):
            raise httpx.ReadError("connection dropped after the server applied the request", request=request)
        return response

    def _route(self, method: str, rest: str, request: httpx.Request) -> httpx.Response:
        if method == "GET" and rest == "root":
            return self._item_json(self.items[""])
        if rest.startswith("root:/"):
            target = rest[len("root:/") :]
            if method == "PUT" and target.endswith(":/content"):
                return self._put(target[: -len(":/content")], request)
            if method == "GET":
                item = self.items.get(target.rstrip("/"))
                return self._item_json(item) if item else httpx.Response(404, json={"error": {"code": "itemNotFound"}})
        if rest.startswith("items/"):
            tail = rest[len("items/") :]
            if method == "PUT" and tail.endswith(":/content") and ":/" in tail[: -len(":/content")]:
                folder_id, name = tail[: -len(":/content")].split(":/", 1)
                folder = self.by_id(folder_id)
                if folder is None or not folder.folder:
                    return httpx.Response(404, json={"error": {"code": "itemNotFound"}})
                return self._put(f"{folder.path}/{name}" if folder.path else name, request)
            if method == "GET" and "/" not in tail:
                item = self.by_id(tail)
                return self._item_json(item) if item else httpx.Response(404, json={"error": {"code": "itemNotFound"}})
            if method == "POST" and tail.endswith("/children"):
                return self._create_folder(tail[: -len("/children")], json.loads(request.content))
            if method == "PATCH":
                rename = parse_qs(urlsplit(str(request.url)).query).get("@microsoft.graph.conflictBehavior") == [
                    "rename"
                ]
                return self._move(tail, json.loads(request.content), rename=rename)
        return httpx.Response(404, json={"error": {"code": "itemNotFound", "message": rest}})

    def _item_json(self, item: Item) -> httpx.Response:
        body: dict[str, Any] = {
            "id": item.id,
            "name": item.path.rsplit("/", 1)[-1],
            "webUrl": f"{SITE_URL}/{item.path}",
        }
        if item.folder:
            body["folder"] = {"childCount": 0}
        else:
            body["file"] = {"mimeType": item.content_type}
            body["size"] = len(item.data)
            body["eTag"] = item.etag
            body["@microsoft.graph.downloadUrl"] = f"https://storage.example/dl/{item.id}"
        return httpx.Response(200, json=body)

    def _put(self, target: str, request: httpx.Request) -> httpx.Response:
        parent = target.rsplit("/", 1)[0] if "/" in target else ""
        if parent not in self.items or not self.items[parent].folder:
            return httpx.Response(404, json={"error": {"code": "itemNotFound", "message": f"no folder {parent}"}})
        existing = self.items.get(target)
        if_match = request.headers.get("if-match")
        if if_match and (existing is None or existing.etag != if_match):
            return httpx.Response(412, json={"error": {"code": "resourceModified"}})
        self._n += 1
        if existing is None:
            existing = Item(id=f"item-{self._n}", path=target, folder=False)
            self.items[target] = existing
        existing.data = request.content
        existing.etag = f'"etag-{self._n}"'
        existing.content_type = request.headers.get("content-type", "")
        return self._item_json(existing)

    def _create_folder(self, parent_id: str, body: dict[str, Any]) -> httpx.Response:
        parent = self.by_id(unquote(parent_id))
        if parent is None or not parent.folder:
            return httpx.Response(404, json={"error": {"code": "itemNotFound"}})
        path = f"{parent.path}/{body['name']}" if parent.path else body["name"]
        if path in self.items:
            return httpx.Response(409, json={"error": {"code": "nameAlreadyExists"}})
        item = Item(id=self._next_id(), path=path, folder=True)
        self.items[path] = item
        return httpx.Response(201, json={"id": item.id, "name": body["name"], "folder": {}})

    def _move(self, item_id: str, body: dict[str, Any], *, rename: bool = False) -> httpx.Response:
        item = self.by_id(unquote(item_id))
        target = self.by_id(body["parentReference"]["id"])
        if item is None or target is None:
            return httpx.Response(404, json={"error": {"code": "itemNotFound"}})
        name = body.get("name") or item.path.rsplit("/", 1)[-1]
        new_path = f"{target.path}/{name}" if target.path else name
        if new_path in self.items and rename:
            stem, dot, ext = name.rpartition(".")
            n = 1
            while new_path in self.items:
                candidate = f"{stem} {n}.{ext}" if dot else f"{name} {n}"
                new_path = f"{target.path}/{candidate}" if target.path else candidate
                n += 1
        if new_path in self.items:
            return httpx.Response(409, json={"error": {"code": "nameAlreadyExists"}})
        del self.items[item.path]
        item.path = new_path
        self.items[new_path] = item
        return self._item_json(item)
