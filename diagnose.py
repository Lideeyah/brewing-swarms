"""Quick contract connectivity diagnostic."""
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

import os
from web3 import Web3

RPC_URL       = os.environ["ARC_RPC_URL"]
ESCROW_ADDR   = os.environ["ESCROW_CONTRACT_ADDRESS"]
USDC_ADDR     = os.environ["USDC_ADDRESS"]
PRIVATE_KEY   = os.environ["ARC_PRIVATE_KEY"]

w3 = Web3(Web3.HTTPProvider(RPC_URL))
print(f"Connected:   {w3.is_connected()}")
print(f"Chain ID:    {w3.eth.chain_id}")
print(f"Block:       {w3.eth.block_number}")

acct = w3.eth.account.from_key(PRIVATE_KEY)
print(f"Wallet:      {acct.address}")

# Minimal ABI — just job_count view
MINIMAL_ABI = [
    {"name": "job_count", "type": "function", "inputs": [],
     "outputs": [{"name": "", "type": "uint256"}], "stateMutability": "view"},
    {"name": "owner", "type": "function", "inputs": [],
     "outputs": [{"name": "", "type": "address"}], "stateMutability": "view"},
    {"name": "usdc_token", "type": "function", "inputs": [],
     "outputs": [{"name": "", "type": "address"}], "stateMutability": "view"},
]

escrow = w3.eth.contract(
    address=Web3.to_checksum_address(ESCROW_ADDR),
    abi=MINIMAL_ABI
)

code = w3.eth.get_code(Web3.to_checksum_address(ESCROW_ADDR))
print(f"Code at addr: {code.hex()[:20]}... ({len(code)} bytes)")

# Check native balance
native = w3.eth.get_balance(acct.address)
print(f"Native bal:   {w3.from_wei(native, 'ether')} (gas token)")

# Check ERC20 USDC balance
ERC20_ABI = [
    {"name": "balanceOf", "type": "function",
     "inputs": [{"name": "_owner", "type": "address"}],
     "outputs": [{"name": "", "type": "uint256"}], "stateMutability": "view"},
    {"name": "allowance", "type": "function",
     "inputs": [{"name": "_owner", "type": "address"}, {"name": "_spender", "type": "address"}],
     "outputs": [{"name": "", "type": "uint256"}], "stateMutability": "view"},
    {"name": "decimals", "type": "function", "inputs": [],
     "outputs": [{"name": "", "type": "uint8"}], "stateMutability": "view"},
]
usdc = w3.eth.contract(address=Web3.to_checksum_address(USDC_ADDR), abi=ERC20_ABI)
try:
    decimals = usdc.functions.decimals().call()
    erc20_bal = usdc.functions.balanceOf(acct.address).call()
    allowance = usdc.functions.allowance(acct.address, Web3.to_checksum_address(ESCROW_ADDR)).call()
    print(f"ERC20 USDC:   {erc20_bal / 10**decimals} (decimals={decimals})")
    print(f"Allowance:    {allowance / 10**decimals} USDC approved to escrow")
except Exception as e:
    print(f"ERC20 check FAILED: {e}")

try:
    count = escrow.functions.job_count().call()
    print(f"job_count(): {count}  ✓")
except Exception as e:
    print(f"job_count() FAILED: {e}")

try:
    owner = escrow.functions.owner().call()
    print(f"owner():     {owner}  ✓")
except Exception as e:
    print(f"owner() FAILED: {e}")

try:
    usdc = escrow.functions.usdc_token().call()
    print(f"usdc_token():{usdc}  ✓")
except Exception as e:
    print(f"usdc_token() FAILED: {e}")
