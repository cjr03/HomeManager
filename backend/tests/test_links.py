from app.accounts import Link, linked_user_ids


def request_link(c, username):
    return c.post("/api/links", json={"username": username})


# ---- unit: linked_user_ids ----

def test_linked_user_ids_only_accepted_both_directions(db, make_user):
    me, a, b, c, d = (make_user() for _ in range(5))
    db.add_all([
        Link(requester_id=me.id, addressee_id=a.id, status="accepted"),
        Link(requester_id=b.id, addressee_id=me.id, status="accepted"),
        Link(requester_id=me.id, addressee_id=c.id, status="pending"),
        Link(requester_id=a.id, addressee_id=d.id, status="accepted"),
    ])
    db.flush()
    assert linked_user_ids(db, me) == {a.id, b.id}
    assert linked_user_ids(db, d) == {a.id}
    assert linked_user_ids(db, c) == set()


# ---- API ----

def test_request_and_accept_link(make_user, client_for):
    ann, bob = make_user("ann"), make_user("bob")
    ca, cb = client_for(ann), client_for(bob)

    r = request_link(ca, "BOB")
    assert r.status_code == 201
    link_id = r.json()["id"]

    out = ca.get("/api/links").json()
    assert out["outgoing"] == [{"id": link_id, "user_id": bob.id, "username": "bob", "avatar": None}]
    assert out["incoming"] == [] and out["linked"] == []

    inc = cb.get("/api/links").json()
    assert inc["incoming"] == [{"id": link_id, "user_id": ann.id, "username": "ann", "avatar": None}]

    assert ca.post(f"/api/links/{link_id}/accept").status_code == 404  # requester can't accept
    assert cb.post(f"/api/links/{link_id}/accept").status_code == 200

    for c, other in ((ca, "bob"), (cb, "ann")):
        body = c.get("/api/links").json()
        assert [x["username"] for x in body["linked"]] == [other]
        assert body["incoming"] == [] and body["outgoing"] == []


def test_request_unknown_user_404(auth_client):
    assert request_link(auth_client, "ghost").status_code == 404


def test_request_self_400(auth_client):
    assert request_link(auth_client, auth_client.user.username.upper()).status_code == 400


def test_request_duplicate_either_direction_409(make_user, client_for):
    ann, bob = make_user("ann"), make_user("bob")
    ca, cb = client_for(ann), client_for(bob)
    assert request_link(ca, "bob").status_code == 201
    assert request_link(ca, "bob").status_code == 409
    assert request_link(cb, "ann").status_code == 409


def test_delete_link_by_either_party(make_user, client_for):
    ann, bob, eve = make_user("ann"), make_user("bob"), make_user("eve")
    ca, cb, ce = client_for(ann), client_for(bob), client_for(eve)
    link_id = request_link(ca, "bob").json()["id"]
    assert ce.delete(f"/api/links/{link_id}").status_code == 404  # outsider
    assert cb.delete(f"/api/links/{link_id}").status_code == 204  # decline
    assert ca.get("/api/links").json()["outgoing"] == []

    link_id = request_link(ca, "bob").json()["id"]  # can re-request after removal
    cb.post(f"/api/links/{link_id}/accept")
    assert ca.delete(f"/api/links/{link_id}").status_code == 204  # unlink
    assert cb.get("/api/links").json()["linked"] == []


def test_accept_unknown_or_outsider_404(make_user, client_for):
    ann, bob, eve = make_user("ann"), make_user("bob"), make_user("eve")
    link_id = request_link(client_for(ann), "bob").json()["id"]
    assert client_for(eve).post(f"/api/links/{link_id}/accept").status_code == 404
    assert client_for(bob).post("/api/links/999999/accept").status_code == 404
