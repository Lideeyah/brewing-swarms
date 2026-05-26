"""
deploy.py — Deploy AgentEscrow.vy to Arc Testnet
=================================================
Usage (two steps):

Step 1 — generate a wallet address to fund:
    python3 deploy.py

Step 2 — after funding via https://faucet.circle.com (Arc Testnet):
    DEPLOYER_KEY=0x... python3 deploy.py

The deployed ESCROW_CONTRACT_ADDRESS is printed and appended to ~/arc/.env.
"""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from web3 import Web3
from vyper.compiler import compile_code

# ── Config ────────────────────────────────────────────────────────────────────

ENV_FILE    = Path(__file__).parent / ".env"
CONTRACT    = Path(__file__).parent / "contracts" / "AgentEscrow.vy"

# Load existing .env if present
load_dotenv(ENV_FILE)

ARC_RPC_URL = os.getenv("ARC_RPC_URL", "https://rpc-arc-testnet.circle.com")

# ── Step 1: generate wallet if no key provided ────────────────────────────────

deployer_key = os.environ.get("DEPLOYER_KEY", "")

if not deployer_key:
    w3_tmp = Web3()
    acct   = w3_tmp.eth.account.create()
    print("\n── New deployer wallet generated ──────────────────────────────")
    print(f"  Address:     {acct.address}")
    print(f"  Private Key: {acct.key.hex()}")
    print("\nNext steps:")
    print("  1. Go to https://faucet.circle.com → Arc Testnet")
    print("  2. Paste the address above → receive 20 USDC")
    print("  3. Re-run:")
    print(f"\n     DEPLOYER_KEY={acct.key.hex()} python3 deploy.py\n")
    sys.exit(0)

# Connect
w3 = Web3(Web3.HTTPProvider(ARC_RPC_URL))

if not w3.is_connected():
    print(f"ERROR: Cannot connect to Arc RPC at {ARC_RPC_URL}")
    print("Check the URL at https://arc.network and update ARC_RPC_URL in ~/arc/.env")
    sys.exit(1)

deployer = w3.eth.account.from_key(deployer_key)
print(f"\n── Deploying AgentEscrow.vy ───────────────────────────────────")
print(f"  Network:   Arc Testnet (chain {w3.eth.chain_id})")
print(f"  Deployer:  {deployer.address}")
print(f"  Note:      Native USDC escrow — no ERC20 token needed")

balance = w3.eth.get_balance(deployer.address)
print(f"  Balance:   {w3.from_wei(balance, 'ether')} (native)")

# Compile
print("\nCompiling contracts/AgentEscrow.vy ...")
source   = CONTRACT.read_text()
compiled = compile_code(source, output_formats=["abi", "bytecode"])
abi      = compiled["abi"]
bytecode = compiled["bytecode"]
print("  ✓ Compiled")

# Deploy — pass USDC address to constructor
factory = w3.eth.contract(abi=abi, bytecode=bytecode)
nonce   = w3.eth.get_transaction_count(deployer.address)

tx = factory.constructor().build_transaction({
    "from":     deployer.address,
    "nonce":    nonce,
    "gas":      2_000_000,
    "gasPrice": w3.eth.gas_price,
})

signed   = deployer.sign_transaction(tx)
tx_hash  = w3.eth.send_raw_transaction(signed.raw_transaction)
print(f"\nBroadcasting tx: {tx_hash.hex()}")
print("Waiting for confirmation (~400ms on Arc)...")

receipt  = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
contract_address = receipt.contractAddress

print(f"\n── Deployed ✓ ─────────────────────────────────────────────────")
print(f"  ESCROW_CONTRACT_ADDRESS: {contract_address}")
print(f"  TX hash:                 {tx_hash.hex()}")
print(f"  Block:                   {receipt.blockNumber}")
print(f"  Gas used:                {receipt.gasUsed}")

# Write to .env
with open(ENV_FILE, "a") as f:
    f.write(f"\nDEPLOYER_KEY={deployer_key}")
    f.write(f"\nESCROW_CONTRACT_ADDRESS={contract_address}")

print(f"\n  Saved to {ENV_FILE}")
print("\nNext step: run the FastAPI server")
print("  uvicorn backend.main:app --reload --port 8000")
