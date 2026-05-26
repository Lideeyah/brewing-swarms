"""
Brewing Circle DCW Integration — Pillar D: Developer-Controlled Wallets
=======================================================================
Provisions agent wallets via Circle's MPC infrastructure.
Keys never leave Circle's HSM — agents sign autonomously without
exposing private key material.

Falls back to web3 ephemeral wallets when Circle credentials are not set.
"""
from __future__ import annotations

import os
import uuid
import logging
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env", override=True)

log = logging.getLogger(__name__)


@dataclass
class AgentWallet:
    address:    str
    wallet_id:  str
    managed:    bool    # True = Circle MPC, False = ephemeral
    provider:   str     # "circle-dcw" | "web3-ephemeral"


class CircleWalletProvider:
    def __init__(self):
        self.api_key       = os.getenv("CIRCLE_API_KEY", "")
        self.entity_secret = os.getenv("CIRCLE_ENTITY_SECRET", "")
        self.wallet_set_id = os.getenv("CIRCLE_WALLET_SET_ID", "")
        self._api_client   = None
        self.available     = False

        if self.api_key and self.entity_secret and self.wallet_set_id:
            try:
                from circle.web3 import utils
                from circle.web3 import developer_controlled_wallets as dcw

                self._api_client = utils.init_developer_controlled_wallets_client(
                    api_key       = self.api_key,
                    entity_secret = self.entity_secret,
                )
                self._wallets_api = dcw.WalletsApi(self._api_client)
                self.available    = True
                log.info("Circle DCW provider initialised ✓")
            except Exception as e:
                log.warning(f"Circle DCW init failed: {e}")

    def create_wallet(self, agent_name: str) -> AgentWallet:
        if not self.available:
            return self._ephemeral()

        try:
            from circle.web3 import utils
            from circle.web3 import developer_controlled_wallets as dcw

            ciphertext = utils.generate_entity_secret_ciphertext(
                self.api_key, self.entity_secret
            )

            req = dcw.CreateWalletRequest(
                idempotency_key          = str(uuid.uuid4()),
                entity_secret_ciphertext = ciphertext,
                wallet_set_id            = self.wallet_set_id,
                blockchains              = [dcw.Blockchain.ARC_MINUS_TESTNET],
                count                    = 1,
                metadata                 = [dcw.WalletMetadata(name=agent_name, ref_id=agent_name)],
            )

            resp   = self._wallets_api.create_wallet(req)
            raw    = resp.data.wallets[0]
            # SDK wraps result in a oneOf container — unwrap actual instance
            wallet = raw.actual_instance if hasattr(raw, "actual_instance") else raw

            log.info(f"Circle DCW wallet created: {agent_name} → {wallet.address}")
            return AgentWallet(
                address   = wallet.address,
                wallet_id = wallet.id,
                managed   = True,
                provider  = "circle-dcw",
            )

        except Exception as e:
            log.warning(f"Circle wallet creation failed ({e}), using ephemeral fallback")
            return self._ephemeral()

    @staticmethod
    def _ephemeral() -> AgentWallet:
        from web3 import Web3
        acct = Web3().eth.account.create()
        return AgentWallet(
            address   = acct.address,
            wallet_id = "ephemeral",
            managed   = False,
            provider  = "web3-ephemeral",
        )


# ── Global singleton ──────────────────────────────────────────────────────────

_provider = CircleWalletProvider()


def provision_agent_wallet(agent_name: str) -> AgentWallet:
    w = _provider.create_wallet(agent_name)
    log.info(f"[{w.provider}] {agent_name} → {w.address}")
    return w
