# pragma version ^0.4.0
# AgentEscrow.vy — Brewing B2B Agent Settlement Contract
# Arc L1: USDC is the NATIVE gas token — use msg.value / send(), no ERC20 needed
#
# Flow: create_job (native USDC locks via msg.value)
#     → complete_job (employer approves → USDC sent to worker)
#     → slash_job    (SLA breach → USDC returned to employer)

# ── Structs ───────────────────────────────────────────────────────────────────

struct Job:
    employer:       address
    worker:         address
    amount:         uint256    # native USDC (wei units, 18 dec at EVM level)
    sla_timeout:    uint256    # absolute Unix timestamp
    status:         uint256    # 0: empty | 1: Funded | 2: Completed | 3: Slashed
    ipfs_spec_hash: bytes32

# ── Constants & State ─────────────────────────────────────────────────────────

# 0.001 USDC minimum (in native EVM wei units)
MIN_AMOUNT: constant(uint256) = 1_000_000_000_000_000

owner:     public(address)
job_count: public(uint256)
jobs:      public(HashMap[uint256, Job])

# ── Events ────────────────────────────────────────────────────────────────────

event JobCreated:
    job_id:      indexed(uint256)
    employer:    indexed(address)
    worker:      indexed(address)
    amount:      uint256
    sla_timeout: uint256

event JobCompleted:
    job_id: indexed(uint256)
    worker: indexed(address)
    amount: uint256

event JobSlashed:
    job_id:   indexed(uint256)
    employer: indexed(address)
    amount:   uint256

event OwnershipTransferred:
    previous:  indexed(address)
    new_owner: indexed(address)

# ── Constructor ───────────────────────────────────────────────────────────────

@deploy
def __init__():
    self.owner = msg.sender

# ── Core Functions ────────────────────────────────────────────────────────────

@payable
@external
def create_job(
    _worker:    address,
    _timeout:   uint256,
    _ipfs_hash: bytes32
) -> uint256:
    """
    Employer posts a job. Native USDC locks in contract via msg.value.
    Returns the new job_id.
    """
    assert _worker != empty(address), "zero worker address"
    assert _worker != msg.sender,     "employer cannot be worker"
    assert msg.value >= MIN_AMOUNT,   "amount below minimum"
    assert _timeout > 0,              "timeout must be positive"

    self.job_count += 1
    job_id: uint256 = self.job_count

    self.jobs[job_id] = Job(
        employer=msg.sender,
        worker=_worker,
        amount=msg.value,
        sla_timeout=block.timestamp + _timeout,
        status=1,
        ipfs_spec_hash=_ipfs_hash,
    )

    log JobCreated(
        job_id=job_id,
        employer=msg.sender,
        worker=_worker,
        amount=msg.value,
        sla_timeout=block.timestamp + _timeout,
    )
    return job_id


@external
def complete_job(_job_id: uint256):
    """
    Employer (or owner) approves work → native USDC sent to worker.
    State updated before transfer (reentrancy guard).
    """
    job: Job = self.jobs[_job_id]
    assert job.status == 1, "job not active"
    assert msg.sender == job.employer or msg.sender == self.owner, "unauthorized"

    self.jobs[_job_id].status = 2
    send(job.worker, job.amount)
    log JobCompleted(job_id=_job_id, worker=job.worker, amount=job.amount)


@external
def slash_job(_job_id: uint256):
    """
    Refunds employer if SLA deadline passed, or owner forces a slash.
    State updated before transfer (reentrancy guard).
    """
    job: Job = self.jobs[_job_id]
    assert job.status == 1, "job not active"
    assert block.timestamp > job.sla_timeout or msg.sender == self.owner, "SLA still active"

    self.jobs[_job_id].status = 3
    send(job.employer, job.amount)
    log JobSlashed(job_id=_job_id, employer=job.employer, amount=job.amount)

# ── Admin ─────────────────────────────────────────────────────────────────────

@external
def transfer_ownership(_new_owner: address):
    assert msg.sender == self.owner, "only owner"
    assert _new_owner != empty(address), "zero address"
    log OwnershipTransferred(previous=self.owner, new_owner=_new_owner)
    self.owner = _new_owner

# ── Views ─────────────────────────────────────────────────────────────────────

@view
@external
def get_job(_job_id: uint256) -> Job:
    return self.jobs[_job_id]

@view
@external
def is_slashable(_job_id: uint256) -> bool:
    job: Job = self.jobs[_job_id]
    return job.status == 1 and block.timestamp > job.sla_timeout
