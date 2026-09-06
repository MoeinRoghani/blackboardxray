"""People, organizations, projects and keys, against a real Postgres."""

from __future__ import annotations

from typing import Any

import pytest

from blackboardxray.server.identity import digest
from blackboardxray.server.people import (
    AlreadyExists,
    Locked,
    NotAllowed,
    PeopleError,
)
from blackboardxray.server.roles import Permission, Role

PASSWORD = "a long enough phrase"


@pytest.fixture
def people(database: Any):
    return database.people


@pytest.fixture
def owner(people: Any):
    return people.create_user("owner@example.com", PASSWORD, "Owner")


@pytest.fixture
def org(people: Any, owner: Any):
    return people.create_organization("acme", "Acme", owner.id)


@pytest.fixture
def project(people: Any, org: Any, owner: Any):
    return people.create_project(org.id, "production", "Production", owner.id)


class TestAccounts:
    def test_an_install_with_nobody_in_it_says_so(self, people: Any) -> None:
        # What the first run screen turns on.
        assert people.count_users() == 0

    def test_an_account_can_be_made_and_found(self, people: Any) -> None:
        made = people.create_user("someone@example.com", PASSWORD, "Someone")
        assert made.public_id.startswith("usr_")
        assert people.find_user(made.public_id) == made
        assert people.count_users() == 1

    def test_an_address_is_taken_once_however_it_is_capitalised(
        self, people: Any
    ) -> None:
        people.create_user("Someone@Example.com", PASSWORD)
        with pytest.raises(AlreadyExists):
            people.create_user("someone@EXAMPLE.com", PASSWORD)

    def test_the_address_is_kept_as_it_was_typed(self, people: Any) -> None:
        # Folded for comparison, shown as the person wrote it.
        made = people.create_user("Someone@Example.com", PASSWORD)
        assert made.email == "Someone@Example.com"

    @pytest.mark.parametrize("given", ["nobody", "@example.com", "someone@"])
    def test_something_that_is_not_an_address_is_refused(
        self, people: Any, given: str
    ) -> None:
        with pytest.raises(PeopleError):
            people.create_user(given, PASSWORD)


class TestSigningIn:
    def test_the_right_password_answers_a_session(
        self, people: Any, owner: Any
    ) -> None:
        signed = people.sign_in("owner@example.com", PASSWORD)
        assert signed is not None
        assert signed.user.id == owner.id
        assert people.read_session(signed.session.value) == owner

    def test_the_address_is_not_case_sensitive(self, people: Any, owner: Any) -> None:
        assert people.sign_in("OWNER@EXAMPLE.COM", PASSWORD) is not None

    def test_the_wrong_password_answers_nothing(self, people: Any, owner: Any) -> None:
        assert people.sign_in("owner@example.com", "not the phrase at all") is None

    def test_an_address_with_no_account_answers_the_same_nothing(
        self, people: Any
    ) -> None:
        # The same answer as a wrong password, because a different one is how a
        # stranger learns which addresses have accounts here.
        assert people.sign_in("nobody@example.com", PASSWORD) is None

    def test_the_session_token_is_not_stored(self, people: Any, owner: Any) -> None:
        # A leaked backup must yield no session anybody can use.
        signed = people.sign_in("owner@example.com", PASSWORD)
        assert signed is not None
        rows = people._db.rows("SELECT token_hash FROM xray_sessions")
        assert rows[0]["token_hash"] != signed.session.value
        assert rows[0]["token_hash"] == digest(signed.session.value)

    def test_a_token_that_was_never_issued_signs_nobody_in(self, people: Any) -> None:
        assert people.read_session("bxs_invented") is None
        assert people.read_session("") is None


class TestLockout:
    def test_enough_wrong_answers_stops_the_account_answering(
        self, people: Any, owner: Any
    ) -> None:
        for _ in range(10):
            assert people.sign_in("owner@example.com", "wrong") is None
        # And now even the right password waits, which is the point.
        with pytest.raises(Locked):
            people.sign_in("owner@example.com", PASSWORD)

    def test_the_count_survives_a_restart(self, people: Any, owner: Any) -> None:
        # Held in the database, because a counter that resets when the process
        # does is a counter an attacker restarts for free.
        for _ in range(4):
            people.sign_in("owner@example.com", "wrong")
        rows = people._db.rows("SELECT failed_logins FROM xray_users")
        assert rows[0]["failed_logins"] == 4

    def test_signing_in_clears_it(self, people: Any, owner: Any) -> None:
        for _ in range(3):
            people.sign_in("owner@example.com", "wrong")
        assert people.sign_in("owner@example.com", PASSWORD) is not None
        rows = people._db.rows("SELECT failed_logins, locked_until FROM xray_users")
        assert rows[0]["failed_logins"] == 0
        assert rows[0]["locked_until"] is None


class TestSessions:
    def test_signing_out_ends_that_session_only(self, people: Any, owner: Any) -> None:
        here = people.sign_in("owner@example.com", PASSWORD)
        there = people.sign_in("owner@example.com", PASSWORD)
        assert here is not None and there is not None
        people.end_session(here.session.value)
        assert people.read_session(here.session.value) is None
        assert people.read_session(there.session.value) == owner

    def test_a_session_can_be_listed_and_the_current_one_is_marked(
        self, people: Any, owner: Any
    ) -> None:
        here = people.sign_in("owner@example.com", PASSWORD)
        people.sign_in("owner@example.com", PASSWORD)
        assert here is not None
        listed = people.list_sessions(owner.id, here.session.value)
        assert len(listed) == 2
        assert sum(1 for one in listed if one["is_current"]) == 1

    def test_ending_the_others_keeps_this_one(self, people: Any, owner: Any) -> None:
        here = people.sign_in("owner@example.com", PASSWORD)
        people.sign_in("owner@example.com", PASSWORD)
        assert here is not None
        assert people.end_other_sessions(owner.id, here.session.value) == 1
        assert people.read_session(here.session.value) == owner

    def test_changing_a_password_ends_every_session(
        self, people: Any, owner: Any
    ) -> None:
        # The reason somebody changes a password is usually that they think
        # somebody else has it.
        signed = people.sign_in("owner@example.com", PASSWORD)
        assert signed is not None
        people.set_password(owner.id, "a different long phrase")
        assert people.read_session(signed.session.value) is None
        assert people.sign_in("owner@example.com", "a different long phrase")

    def test_an_expired_session_signs_nobody_in(self, people: Any, owner: Any) -> None:
        signed = people.sign_in("owner@example.com", PASSWORD)
        assert signed is not None
        people._db.run("UPDATE xray_sessions SET expires_at = now() - interval '1 day'")
        assert people.read_session(signed.session.value) is None
        assert people.sweep_sessions() == 1


class TestOrganizationsAndProjects:
    def test_whoever_makes_an_organization_owns_it(
        self, people: Any, owner: Any, org: Any
    ) -> None:
        assert people.org_role(org.id, owner.id) is Role.OWNER

    def test_a_slug_is_taken_once(self, people: Any, owner: Any, org: Any) -> None:
        with pytest.raises(AlreadyExists):
            people.create_organization("acme", "Acme Again", owner.id)

    def test_two_organizations_may_each_have_a_project_called_production(
        self, people: Any, owner: Any, org: Any, project: Any
    ) -> None:
        other = people.create_organization("beta", "Beta", owner.id)
        second = people.create_project(other.id, "production", "Production", owner.id)
        assert second.public_id != project.public_id

    def test_a_slug_is_taken_once_inside_an_organization(
        self, people: Any, org: Any, owner: Any, project: Any
    ) -> None:
        with pytest.raises(AlreadyExists):
            people.create_project(org.id, "production", "Again", owner.id)

    def test_deleting_a_project_takes_what_was_recorded_under_it(
        self, people: Any, database: Any, project: Any
    ) -> None:
        database.run(
            "INSERT INTO xray_runs (project_id, board_id) VALUES (%s, 'incident-1')",
            (project.id,),
        )
        people.delete_project(project.id)
        assert database.rows("SELECT 1 FROM xray_runs") == []


class TestWhoSeesWhat:
    def test_a_member_of_the_organization_may_read_its_projects(
        self, people: Any, org: Any, project: Any
    ) -> None:
        member = people.create_user("member@example.com", PASSWORD)
        people.set_member_role(org.id, member.id, Role.MEMBER)
        access = people.access(member, project)
        assert access is not None and access.role is Role.MEMBER
        assert access.may(Permission.READ_PROJECT)
        assert not access.may(Permission.MANAGE_KEYS)

    def test_a_stranger_may_read_nothing(self, people: Any, project: Any) -> None:
        stranger = people.create_user("stranger@example.com", PASSWORD)
        assert people.access(stranger, project) is None
        assert people.projects_for(stranger.id) == []

    def test_a_project_role_replaces_the_organization_role(
        self, people: Any, org: Any, project: Any
    ) -> None:
        person = people.create_user("one@example.com", PASSWORD)
        people.set_member_role(org.id, person.id, Role.MEMBER)
        people.set_project_role(project.id, person.id, Role.ADMIN)
        access = people.access(person, project)
        assert access is not None and access.role is Role.ADMIN

    def test_a_project_role_may_be_lower_than_the_organization_role(
        self, people: Any, org: Any, project: Any
    ) -> None:
        person = people.create_user("two@example.com", PASSWORD)
        people.set_member_role(org.id, person.id, Role.ADMIN)
        people.set_project_role(project.id, person.id, Role.VIEWER)
        access = people.access(person, project)
        assert access is not None and access.role is Role.VIEWER
        assert not access.may(Permission.READ_CONTENT)

    def test_none_at_the_organization_plus_one_project_is_that_project_only(
        self, people: Any, org: Any, owner: Any, project: Any
    ) -> None:
        other = people.create_project(org.id, "staging", "Staging", owner.id)
        person = people.create_user("three@example.com", PASSWORD)
        people.set_member_role(org.id, person.id, Role.NONE)
        people.set_project_role(project.id, person.id, Role.MEMBER)
        assert people.access(person, project) is not None
        assert people.access(person, other) is None
        listed = people.projects_for(person.id)
        assert [one["slug"] for one in listed] == ["production"]

    def test_the_list_shows_exactly_what_a_read_would_allow(
        self, people: Any, org: Any, owner: Any, project: Any
    ) -> None:
        # A list that showed a project a read then refused would be a promise
        # the next click breaks.
        other = people.create_project(org.id, "staging", "Staging", owner.id)
        for role in (Role.OWNER, Role.ADMIN, Role.MEMBER, Role.VIEWER, Role.NONE):
            person = people.create_user(f"each-{role.value}@example.com", PASSWORD)
            people.set_member_role(org.id, person.id, role)
            listed = {one["slug"] for one in people.projects_for(person.id)}
            readable = {
                one.slug
                for one in (project, other)
                if people.access(person, one) is not None
            }
            assert listed == readable, role


class TestMembership:
    def test_the_last_owner_cannot_be_removed(
        self, people: Any, org: Any, owner: Any
    ) -> None:
        # An organization with no owner is one nobody can add an owner to.
        with pytest.raises(NotAllowed, match="only owner"):
            people.remove_member(org.id, owner.id)

    def test_an_owner_can_be_removed_once_there_is_another(
        self, people: Any, org: Any, owner: Any
    ) -> None:
        second = people.create_user("second@example.com", PASSWORD)
        people.set_member_role(org.id, second.id, Role.OWNER)
        people.remove_member(org.id, owner.id)
        assert people.org_role(org.id, owner.id) is None

    def test_a_role_can_be_changed(self, people: Any, org: Any) -> None:
        person = people.create_user("four@example.com", PASSWORD)
        people.set_member_role(org.id, person.id, Role.VIEWER)
        people.set_member_role(org.id, person.id, Role.ADMIN)
        assert people.org_role(org.id, person.id) is Role.ADMIN


class TestKeys:
    def test_a_key_is_readable_once_and_stored_hashed(
        self, people: Any, project: Any
    ) -> None:
        made = people.issue_key(project.id, "ci")
        assert made.value.startswith("bxr_")
        listed = people.list_keys(project.id)
        assert len(listed) == 1
        assert listed[0]["prefix"] == made.value[:12]
        assert made.value not in str(listed[0])

    def test_a_revoked_key_is_still_listed(self, people: Any, project: Any) -> None:
        # The row stays, so the record of what once had access stays.
        made = people.issue_key(project.id, "ci")
        listed = people.list_keys(project.id)
        assert people.revoke_key(project.id, listed[0]["id"])
        again = people.list_keys(project.id)
        assert len(again) == 1 and again[0]["disabled_at"] is not None
        assert made.value

    def test_revoking_twice_is_answered_honestly(
        self, people: Any, project: Any
    ) -> None:
        people.issue_key(project.id, "ci")
        public = people.list_keys(project.id)[0]["id"]
        assert people.revoke_key(project.id, public) is True
        assert people.revoke_key(project.id, public) is False

    def test_a_key_belonging_to_another_project_is_not_revoked_from_here(
        self, people: Any, org: Any, owner: Any, project: Any
    ) -> None:
        other = people.create_project(org.id, "staging", "Staging", owner.id)
        people.issue_key(other.id, "theirs")
        public = people.list_keys(other.id)[0]["id"]
        assert people.revoke_key(project.id, public) is False


class TestInvites:
    def test_an_invite_is_readable_once_and_joins_the_organization(
        self, people: Any, org: Any, owner: Any
    ) -> None:
        token = people.create_invite(org.id, "new@example.com", Role.MEMBER, owner.id)
        offered = people.read_invite(token.value)
        assert offered is not None and offered["org_name"] == "Acme"

        joining = people.create_user("new@example.com", PASSWORD)
        joined = people.accept_invite(token.value, joining.id)
        assert joined is not None and joined.id == org.id
        assert people.org_role(org.id, joining.id) is Role.MEMBER

    def test_an_invite_is_spent_once(self, people: Any, org: Any, owner: Any) -> None:
        # A link opened twice at once must not make two memberships.
        token = people.create_invite(org.id, "new@example.com", Role.MEMBER, owner.id)
        first = people.create_user("first@example.com", PASSWORD)
        second = people.create_user("second@example.com", PASSWORD)
        assert people.accept_invite(token.value, first.id) is not None
        assert people.accept_invite(token.value, second.id) is None
        assert people.org_role(org.id, second.id) is None

    def test_an_expired_invite_offers_nothing(
        self, people: Any, org: Any, owner: Any
    ) -> None:
        token = people.create_invite(org.id, "new@example.com", Role.MEMBER, owner.id)
        people._db.run("UPDATE xray_invites SET expires_at = now() - interval '1 day'")
        assert people.read_invite(token.value) is None
        joining = people.create_user("new@example.com", PASSWORD)
        assert people.accept_invite(token.value, joining.id) is None

    def test_an_invented_token_offers_nothing(self, people: Any) -> None:
        assert people.read_invite("bxi_invented") is None

    def test_a_revoked_invite_cannot_be_accepted(
        self, people: Any, org: Any, owner: Any
    ) -> None:
        token = people.create_invite(org.id, "new@example.com", Role.MEMBER, owner.id)
        public = people.list_invites(org.id)[0]["id"]
        assert people.revoke_invite(org.id, public) is True
        assert people.read_invite(token.value) is None

    def test_the_token_is_not_stored(self, people: Any, org: Any, owner: Any) -> None:
        token = people.create_invite(org.id, "new@example.com", Role.MEMBER, owner.id)
        rows = people._db.rows("SELECT token_hash FROM xray_invites")
        assert rows[0]["token_hash"] == digest(token.value)
        assert rows[0]["token_hash"] != token.value
