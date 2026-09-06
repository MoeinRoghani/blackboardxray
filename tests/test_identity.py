"""Credentials and the role model. Neither touches a database."""

from __future__ import annotations

import pytest

from blackboardxray.server import roles
from blackboardxray.server.identity import (
    MINIMUM_PASSWORD,
    SCRYPT_N,
    WeakPassword,
    check_password,
    digest,
    hash_password,
    issue,
    needs_rehash,
    public_id,
    verify_password,
)
from blackboardxray.server.roles import Permission, Role


class TestPasswords:
    def test_a_password_verifies_against_its_own_hash(self) -> None:
        stored = hash_password("a long enough phrase")
        assert verify_password("a long enough phrase", stored)

    def test_a_different_password_does_not(self) -> None:
        stored = hash_password("a long enough phrase")
        assert not verify_password("a long enough phrose", stored)

    def test_the_same_password_hashes_differently_every_time(self) -> None:
        # Salted, so two people who chose the same password do not have the
        # same row, and a stolen database cannot be sorted for popular ones.
        first = hash_password("a long enough phrase")
        second = hash_password("a long enough phrase")
        assert first != second
        assert verify_password("a long enough phrase", first)
        assert verify_password("a long enough phrase", second)

    def test_the_stored_form_names_its_algorithm_and_cost(self) -> None:
        # What makes raising the cost possible later without locking anyone out.
        stored = hash_password("a long enough phrase")
        algorithm, n, r, p, salt, key = stored.split("$")
        assert algorithm == "scrypt"
        assert int(n) == SCRYPT_N
        assert int(r) > 0 and int(p) > 0
        assert salt and key

    def test_the_password_is_nowhere_in_the_stored_form(self) -> None:
        assert "a long enough phrase" not in hash_password("a long enough phrase")

    @pytest.mark.parametrize("given", ["", "short", "nine char"])
    def test_a_password_below_the_floor_is_refused(self, given: str) -> None:
        assert len(given) < MINIMUM_PASSWORD
        with pytest.raises(WeakPassword):
            check_password(given)

    def test_a_password_is_not_refused_for_its_composition(self) -> None:
        # Length is the only rule. Composition rules push people towards
        # Passw0rd! and away from the phrases that are actually harder to guess.
        check_password("correct horse battery staple")

    @pytest.mark.parametrize(
        "stored",
        ["", "not-a-hash", "scrypt$bad", "argon2$1$2$3$4$5", "scrypt$x$8$1$aa$bb"],
    )
    def test_a_hash_this_build_cannot_read_is_a_no_and_not_a_crash(
        self, stored: str
    ) -> None:
        # One corrupt row must not turn the sign in page into a five hundred.
        assert verify_password("a long enough phrase", stored) is False

    def test_a_hash_made_at_todays_cost_is_not_rehashed(self) -> None:
        assert not needs_rehash(hash_password("a long enough phrase"))

    def test_a_hash_made_at_a_lower_cost_is_rehashed(self) -> None:
        stored = hash_password("a long enough phrase")
        algorithm, _, r, p, salt, key = stored.split("$")
        weaker = "$".join([algorithm, str(SCRYPT_N // 2), r, p, salt, key])
        assert needs_rehash(weaker)

    def test_a_hash_from_an_algorithm_this_build_does_not_use_is_rehashed(
        self,
    ) -> None:
        assert needs_rehash("argon2id$3$65536$4$salt$key")


class TestSecrets:
    def test_a_secret_carries_its_prefix_and_its_digest(self) -> None:
        made = issue("bxr_")
        assert made.value.startswith("bxr_")
        assert made.digest == digest(made.value)

    def test_two_secrets_are_never_the_same(self) -> None:
        assert len({issue("bxr_").value for _ in range(200)}) == 200

    def test_a_public_identifier_says_what_it_names_and_nothing_else(self) -> None:
        made = public_id("proj")
        assert made.startswith("proj_")
        # No sequence in it, so it cannot be counted or walked.
        assert len({public_id("proj") for _ in range(200)}) == 200


class TestTheRoleModel:
    def test_an_owner_may_do_everything(self) -> None:
        assert all(roles.allows(Role.OWNER, one) for one in Permission)

    def test_nobody_but_an_owner_may_delete_the_organization(self) -> None:
        for role in Role:
            if role is Role.OWNER:
                continue
            assert not roles.allows(role, Permission.DELETE_ORG)

    def test_an_admin_may_not_touch_owners(self) -> None:
        # An admin who could make somebody an owner could make themselves one.
        assert not roles.allows(Role.ADMIN, Permission.MANAGE_OWNERS)
        assert not roles.may_grant(Role.ADMIN, Role.OWNER)
        assert not roles.outranks(Role.ADMIN, Role.OWNER)

    def test_a_member_reads_and_configures_nothing(self) -> None:
        assert roles.allows(Role.MEMBER, Permission.READ_PROJECT)
        assert not roles.allows(Role.MEMBER, Permission.MANAGE_KEYS)
        assert not roles.allows(Role.MEMBER, Permission.MANAGE_PROJECT)
        assert not roles.allows(Role.MEMBER, Permission.MANAGE_MEMBERS)

    def test_a_viewer_reads_what_happened_and_not_what_was_written(self) -> None:
        # A contribution is the application's own data. The lowest role that
        # can be handed out sees the shape of a run without its contents.
        assert roles.allows(Role.VIEWER, Permission.READ_PROJECT)
        assert not roles.allows(Role.VIEWER, Permission.READ_CONTENT)

    def test_none_may_do_nothing_at_all(self) -> None:
        assert not any(roles.allows(Role.NONE, one) for one in Permission)

    def test_every_role_is_in_the_table(self) -> None:
        # A role added without a row would fall through to a KeyError at the
        # moment somebody first held it, which is the worst time to find out.
        assert set(roles.GRANTS) == set(Role)
        assert set(roles.RANK) == set(Role)


class TestTheEffectiveRole:
    def test_the_project_role_replaces_the_organization_role(self) -> None:
        assert roles.effective(Role.MEMBER, Role.ADMIN) is Role.ADMIN

    def test_a_project_role_may_be_lower_than_the_organization_role(self) -> None:
        # Taking the greater of the two would make it impossible to give
        # somebody less on one project than they have everywhere else, which is
        # most of why the override exists.
        assert roles.effective(Role.ADMIN, Role.VIEWER) is Role.VIEWER

    def test_the_organization_role_applies_where_the_project_says_nothing(
        self,
    ) -> None:
        assert roles.effective(Role.MEMBER, None) is Role.MEMBER

    def test_somebody_in_neither_has_no_access(self) -> None:
        assert roles.effective(None, None) is Role.NONE

    def test_none_at_the_organization_plus_a_project_role_is_that_project_only(
        self,
    ) -> None:
        # The case `none` exists for: one project and nothing else.
        assert roles.effective(Role.NONE, Role.MEMBER) is Role.MEMBER
        assert roles.effective(Role.NONE, None) is Role.NONE


class TestGranting:
    def test_nobody_grants_a_role_at_or_above_their_own(self) -> None:
        assert not roles.may_grant(Role.ADMIN, Role.ADMIN)
        assert not roles.may_grant(Role.MEMBER, Role.ADMIN)
        assert roles.may_grant(Role.ADMIN, Role.MEMBER)

    def test_only_an_owner_grants_ownership(self) -> None:
        assert roles.may_grant(Role.OWNER, Role.OWNER)
        for role in (Role.ADMIN, Role.MEMBER, Role.VIEWER, Role.NONE):
            assert not roles.may_grant(role, Role.OWNER)

    def test_equals_do_not_act_on_each_other(self) -> None:
        # An organization that loses both its administrators in one afternoon.
        for role in Role:
            assert not roles.outranks(role, role)


class TestReadingARole:
    @pytest.mark.parametrize("given", ["owner", "OWNER", " Owner "])
    def test_a_role_is_read_however_it_was_written(self, given: str) -> None:
        assert roles.read(given) is Role.OWNER

    @pytest.mark.parametrize("given", [None, "", "superuser", "root"])
    def test_anything_else_is_not_a_role(self, given: str | None) -> None:
        assert roles.read(given) is None
