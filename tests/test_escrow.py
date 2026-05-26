"""
AgentEscrow.vy — titanoboa test suite (native USDC edition)
============================================================
Run from ~/arc:
    pytest tests/ -v

Arc L1: USDC is the native gas token — no ERC20, use msg.value / send().
"""
import pytest
import boa

# ── Constants ─────────────────────────────────────────────────────────────────

# 1 USDC in native EVM units (18 dec at EVM level on Arc)
ONE_USDC   = 10 ** 18
MIN_AMOUNT = 10 ** 15   # 0.001 USDC — contract minimum
ZERO_ADDR  = "0x0000000000000000000000000000000000000000"

# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def accounts():
    """5 addresses: [owner, employer, worker, stranger, worker2]"""
    accts = [boa.env.generate_address() for _ in range(5)]
    # Fund each with native USDC for testing
    for a in accts:
        boa.env.set_balance(a, 1_000 * ONE_USDC)
    return accts


@pytest.fixture(scope="module")
def escrow(accounts):
    """Deploy AgentEscrow.vy with accounts[0] as owner."""
    with boa.env.prank(accounts[0]):
        contract = boa.load("contracts/AgentEscrow.vy")
    return contract


# ── Helpers ───────────────────────────────────────────────────────────────────

def create_job(escrow, employer, worker, amount=ONE_USDC, timeout=3_600):
    """Send native USDC + create_job. Returns job_id."""
    with boa.env.prank(employer):
        job_id = escrow.create_job(worker, timeout, b"\x00" * 32, value=amount)
    return job_id


# ── Tests: deployment ─────────────────────────────────────────────────────────

def test_owner_set_on_deploy(escrow, accounts):
    assert escrow.owner() == accounts[0]


def test_job_count_starts_at_zero(escrow):
    assert escrow.job_count() == 0


# ── Tests: create_job ─────────────────────────────────────────────────────────

def test_create_job_locks_usdc(escrow, accounts):
    employer, worker = accounts[1], accounts[2]
    before = boa.env.get_balance(escrow.address)
    create_job(escrow, employer, worker, ONE_USDC)
    assert boa.env.get_balance(escrow.address) == before + ONE_USDC


def test_create_job_increments_counter(escrow, accounts):
    before = escrow.job_count()
    create_job(escrow, accounts[1], accounts[2])
    assert escrow.job_count() == before + 1


def test_create_job_sets_status_funded(escrow, accounts):
    job_id = create_job(escrow, accounts[1], accounts[2])
    assert escrow.get_job(job_id)[4] == 1  # status == Funded


def test_create_job_records_employer_and_worker(escrow, accounts):
    employer, worker = accounts[1], accounts[2]
    job_id = create_job(escrow, employer, worker)
    job = escrow.get_job(job_id)
    assert job[0] == employer
    assert job[1] == worker


def test_create_job_rejects_below_minimum(escrow, accounts):
    with pytest.raises(Exception):
        create_job(escrow, accounts[1], accounts[2], amount=MIN_AMOUNT - 1)


def test_create_job_rejects_self_as_worker(escrow, accounts):
    with pytest.raises(Exception):
        create_job(escrow, accounts[1], accounts[1])


def test_create_job_rejects_zero_timeout(escrow, accounts):
    with pytest.raises(Exception):
        create_job(escrow, accounts[1], accounts[2], timeout=0)


# ── Tests: complete_job ───────────────────────────────────────────────────────

def test_complete_job_pays_worker(escrow, accounts):
    employer, worker = accounts[1], accounts[2]
    job_id = create_job(escrow, employer, worker, ONE_USDC)
    before = boa.env.get_balance(worker)
    with boa.env.prank(employer):
        escrow.complete_job(job_id)
    assert boa.env.get_balance(worker) == before + ONE_USDC


def test_complete_job_sets_status_completed(escrow, accounts):
    employer, worker = accounts[1], accounts[2]
    job_id = create_job(escrow, employer, worker, ONE_USDC)
    with boa.env.prank(employer):
        escrow.complete_job(job_id)
    assert escrow.get_job(job_id)[4] == 2  # Completed


def test_complete_job_owner_can_release(escrow, accounts):
    employer, worker, owner = accounts[1], accounts[2], accounts[0]
    job_id = create_job(escrow, employer, worker, ONE_USDC)
    with boa.env.prank(owner):
        escrow.complete_job(job_id)
    assert escrow.get_job(job_id)[4] == 2


def test_complete_job_stranger_cannot_release(escrow, accounts):
    employer, worker, stranger = accounts[1], accounts[2], accounts[3]
    job_id = create_job(escrow, employer, worker, ONE_USDC)
    with pytest.raises(Exception):
        with boa.env.prank(stranger):
            escrow.complete_job(job_id)


def test_complete_job_double_settle_fails(escrow, accounts):
    employer, worker = accounts[1], accounts[2]
    job_id = create_job(escrow, employer, worker, ONE_USDC)
    with boa.env.prank(employer):
        escrow.complete_job(job_id)
    with pytest.raises(Exception):
        with boa.env.prank(employer):
            escrow.complete_job(job_id)


# ── Tests: slash_job ──────────────────────────────────────────────────────────

def test_slash_after_timeout_refunds_employer(escrow, accounts):
    employer, worker = accounts[1], accounts[2]
    job_id = create_job(escrow, employer, worker, ONE_USDC, timeout=1)
    before = boa.env.get_balance(employer)
    boa.env.time_travel(seconds=2)
    with boa.env.prank(employer):
        escrow.slash_job(job_id)
    assert boa.env.get_balance(employer) == before + ONE_USDC


def test_slash_sets_status_slashed(escrow, accounts):
    employer, worker = accounts[1], accounts[2]
    job_id = create_job(escrow, employer, worker, ONE_USDC, timeout=1)
    boa.env.time_travel(seconds=2)
    with boa.env.prank(employer):
        escrow.slash_job(job_id)
    assert escrow.get_job(job_id)[4] == 3  # Slashed


def test_slash_before_timeout_reverts(escrow, accounts):
    employer, worker = accounts[1], accounts[2]
    job_id = create_job(escrow, employer, worker, ONE_USDC, timeout=9_999)
    with pytest.raises(Exception):
        with boa.env.prank(employer):
            escrow.slash_job(job_id)


def test_owner_can_force_slash_anytime(escrow, accounts):
    employer, worker, owner = accounts[1], accounts[2], accounts[0]
    job_id = create_job(escrow, employer, worker, ONE_USDC, timeout=9_999)
    before = boa.env.get_balance(employer)
    with boa.env.prank(owner):
        escrow.slash_job(job_id)
    assert boa.env.get_balance(employer) == before + ONE_USDC


# ── Tests: is_slashable ───────────────────────────────────────────────────────

def test_is_slashable_false_before_timeout(escrow, accounts):
    job_id = create_job(escrow, accounts[1], accounts[2], timeout=9_999)
    assert escrow.is_slashable(job_id) is False


def test_is_slashable_true_after_timeout(escrow, accounts):
    job_id = create_job(escrow, accounts[1], accounts[2], timeout=1)
    boa.env.time_travel(seconds=2)
    assert escrow.is_slashable(job_id) is True


# ── Tests: transfer_ownership ─────────────────────────────────────────────────

def test_transfer_ownership(escrow, accounts):
    owner, new_owner = accounts[0], accounts[4]
    with boa.env.prank(owner):
        escrow.transfer_ownership(new_owner)
    assert escrow.owner() == new_owner
    with boa.env.prank(new_owner):
        escrow.transfer_ownership(owner)
    assert escrow.owner() == owner


def test_non_owner_cannot_transfer_ownership(escrow, accounts):
    with pytest.raises(Exception):
        with boa.env.prank(accounts[3]):
            escrow.transfer_ownership(accounts[3])
