#!/usr/bin/env python3
"""
MCP Server for Portfolio Tracker Web.

Provides conversational access to crypto portfolio data: holdings, P&L,
transactions, cash flow, tax reports, and price data. Connects to the
Portfolio Tracker Web API using API key authentication.

Environment variables:
    PORTFOLIO_API_URL: Base URL of the Portfolio Tracker Web instance
                       (default: http://localhost:3000)
    PORTFOLIO_API_KEY: API key generated from Portfolio Tracker account settings
"""

import json
import os
from contextlib import asynccontextmanager
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, ConfigDict, Field, field_validator

# ---------------------------------------------------------------------------
# Configuration - auto-load .env from project root if present
# ---------------------------------------------------------------------------

_env_path = Path(__file__).resolve().parent.parent / ".env"
if _env_path.exists():
    for line in _env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())

API_BASE_URL = os.environ.get("PORTFOLIO_API_URL", "http://localhost:3000")
API_KEY = os.environ.get("PORTFOLIO_API_KEY", "")
DEFAULT_TIMEOUT = 30.0


# ---------------------------------------------------------------------------
# Lifespan: shared httpx client
# ---------------------------------------------------------------------------

@asynccontextmanager
async def app_lifespan():
    """Manage a shared httpx client across tool calls."""
    client = httpx.AsyncClient(
        base_url=API_BASE_URL,
        timeout=DEFAULT_TIMEOUT,
        headers={"X-API-Key": API_KEY},
    )
    try:
        yield {"http": client}
    finally:
        await client.aclose()


mcp = FastMCP("portfolio_mcp", lifespan=app_lifespan)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _get_client(ctx) -> httpx.AsyncClient:
    """Retrieve the shared httpx client from lifespan state."""
    return ctx.request_context.lifespan_state["http"]


async def _api_get(ctx, path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Make a GET request to the Portfolio Tracker API."""
    client = _get_client(ctx)
    resp = await client.get(path, params=params)
    resp.raise_for_status()
    return resp.json()


async def _api_post(ctx, path: str, json_body: Optional[Dict[str, Any]] = None,
                    params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Make a POST request to the Portfolio Tracker API."""
    client = _get_client(ctx)
    resp = await client.post(path, json=json_body, params=params)
    resp.raise_for_status()
    return resp.json()


async def _api_put(ctx, path: str, json_body: Dict[str, Any]) -> Dict[str, Any]:
    """Make a PUT request to the Portfolio Tracker API."""
    client = _get_client(ctx)
    resp = await client.put(path, json=json_body)
    resp.raise_for_status()
    return resp.json()


async def _api_delete(ctx, path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Make a DELETE request to the Portfolio Tracker API."""
    client = _get_client(ctx)
    resp = await client.delete(path, params=params)
    resp.raise_for_status()
    return resp.json()


def _handle_error(e: Exception) -> str:
    """Consistent error formatting across all tools."""
    if isinstance(e, httpx.HTTPStatusError):
        status = e.response.status_code
        try:
            detail = e.response.json().get("error", "")
        except Exception:
            detail = e.response.text[:200]
        messages = {
            401: f"Authentication failed. Check your PORTFOLIO_API_KEY. Detail: {detail}",
            403: f"Permission denied. {detail}",
            404: f"Not found. {detail}",
            429: "Rate limit exceeded. Wait a moment and retry.",
        }
        return f"Error: {messages.get(status, f'API returned status {status}. {detail}')}"
    if isinstance(e, httpx.TimeoutException):
        return "Error: Request timed out. Is your Portfolio Tracker running?"
    if isinstance(e, httpx.ConnectError):
        return (
            f"Error: Cannot connect to {API_BASE_URL}. "
            "Make sure your Portfolio Tracker Web is running."
        )
    return f"Error: {type(e).__name__}: {e}"


def _fmt_usd(value: float) -> str:
    """Format a number as USD."""
    if abs(value) >= 1:
        return f"${value:,.2f}"
    return f"${value:.6f}"


def _fmt_pct(value: float) -> str:
    """Format a number as percentage with sign."""
    sign = "+" if value >= 0 else ""
    return f"{sign}{value:.2f}%"


def _fmt_qty(value: float) -> str:
    """Format a quantity with appropriate precision."""
    if abs(value) >= 100:
        return f"{value:,.2f}"
    if abs(value) >= 1:
        return f"{value:,.4f}"
    return f"{value:.8f}"


# ---------------------------------------------------------------------------
# Enums & Input Models
# ---------------------------------------------------------------------------

class ResponseFormat(str, Enum):
    MARKDOWN = "markdown"
    JSON = "json"


class TaxStrategy(str, Enum):
    FIFO = "FIFO"
    LIFO = "LIFO"
    HIFO = "HIFO"
    LOFO = "LOFO"


class TransactionType(str, Enum):
    DEPOSIT = "Deposit"
    WITHDRAWAL = "Withdrawal"
    SWAP = "Swap"


# --- Portfolio tools ---

class GetHoldingsInput(BaseModel):
    """Input for retrieving portfolio holdings and summary."""
    model_config = ConfigDict(str_strip_whitespace=True)

    portfolio_id: int = Field(default=1, description="Portfolio ID (default: 1)", ge=1)
    response_format: ResponseFormat = Field(
        default=ResponseFormat.MARKDOWN,
        description="'markdown' for readable output, 'json' for raw data",
    )


class GetHistoryInput(BaseModel):
    """Input for retrieving portfolio value history."""
    model_config = ConfigDict(str_strip_whitespace=True)

    portfolio_id: int = Field(default=1, description="Portfolio ID (default: 1)", ge=1)
    days: int = Field(default=7, description="Number of days of history (max 90)", ge=1, le=90)
    response_format: ResponseFormat = Field(default=ResponseFormat.MARKDOWN)


# --- Transaction tools ---

class ListTransactionsInput(BaseModel):
    """Input for listing transactions."""
    model_config = ConfigDict(str_strip_whitespace=True)

    portfolio_id: Optional[int] = Field(default=None, description="Portfolio ID, or omit for all")
    response_format: ResponseFormat = Field(default=ResponseFormat.MARKDOWN)


class AddTransactionInput(BaseModel):
    """Input for adding a transaction."""
    model_config = ConfigDict(str_strip_whitespace=True)

    portfolio_id: int = Field(default=1, description="Portfolio ID", ge=1)
    type: TransactionType = Field(..., description="Transaction type: Deposit, Withdrawal, or Swap")
    datetime: str = Field(..., description="Transaction datetime as ISO string (e.g. '2025-01-15T10:30:00Z')")
    to_asset: str = Field(..., description="Asset received (e.g. 'BTC', 'ETH', 'ADA')", min_length=1, max_length=10)
    to_quantity: float = Field(..., description="Quantity received", ge=0)
    to_price_usd: Optional[float] = Field(default=None, description="Price per unit in USD at time of transaction")
    from_asset: Optional[str] = Field(default=None, description="Asset sold (required for Swap)", max_length=10)
    from_quantity: Optional[float] = Field(default=None, description="Quantity sold (required for Swap)", ge=0)
    from_price_usd: Optional[float] = Field(default=None, description="Price per unit of sold asset in USD (required for Swap)")
    fees_usd: Optional[float] = Field(default=None, description="Transaction fees in USD")
    notes: Optional[str] = Field(default=None, description="Optional notes", max_length=500)

    @field_validator("to_asset", "from_asset", mode="before")
    @classmethod
    def uppercase_asset(cls, v):
        return v.upper() if isinstance(v, str) else v


class DeleteTransactionInput(BaseModel):
    """Input for deleting a transaction."""
    model_config = ConfigDict(str_strip_whitespace=True)

    transaction_id: int = Field(..., description="Transaction ID to delete", ge=1)


# --- Cashflow ---

class GetCashflowInput(BaseModel):
    """Input for cash flow analysis."""
    model_config = ConfigDict(str_strip_whitespace=True)

    portfolio_id: int = Field(default=1, description="Portfolio ID", ge=1)
    response_format: ResponseFormat = Field(default=ResponseFormat.MARKDOWN)


# --- Tax ---

class GetTaxReportInput(BaseModel):
    """Input for Romania tax report."""
    model_config = ConfigDict(str_strip_whitespace=True)

    year: int = Field(default=2025, description="Tax year", ge=2015, le=2030)
    portfolio_id: Optional[int] = Field(default=None, description="Portfolio ID, or omit for all")
    asset_strategy: TaxStrategy = Field(default=TaxStrategy.FIFO, description="Lot selection strategy for assets")
    cash_strategy: TaxStrategy = Field(default=TaxStrategy.FIFO, description="Lot selection strategy for cash")
    response_format: ResponseFormat = Field(default=ResponseFormat.MARKDOWN)


# --- Prices ---

class GetPricesInput(BaseModel):
    """Input for fetching current asset prices."""
    model_config = ConfigDict(str_strip_whitespace=True)

    symbols: str = Field(
        ...,
        description="Comma-separated asset symbols (e.g. 'BTC,ETH,ADA')",
        min_length=1, max_length=200,
    )

    @field_validator("symbols")
    @classmethod
    def validate_symbols(cls, v: str) -> str:
        return ",".join(s.strip().upper() for s in v.split(",") if s.strip())


class GetPriceHistoryInput(BaseModel):
    """Input for fetching historical prices."""
    model_config = ConfigDict(str_strip_whitespace=True)

    symbols: str = Field(..., description="Comma-separated symbols (e.g. 'BTC,ETH')", min_length=1)
    start_timestamp: int = Field(..., description="Start date as Unix timestamp (seconds)")
    end_timestamp: int = Field(..., description="End date as Unix timestamp (seconds)")

    @field_validator("symbols")
    @classmethod
    def validate_symbols(cls, v: str) -> str:
        return ",".join(s.strip().upper() for s in v.split(",") if s.strip())


# --- Portfolios ---

class ListPortfoliosInput(BaseModel):
    """Input for listing portfolios."""
    model_config = ConfigDict(str_strip_whitespace=True)

    response_format: ResponseFormat = Field(default=ResponseFormat.MARKDOWN)


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

# ---- Holdings & Summary ----

@mcp.tool(
    name="portfolio_get_holdings",
    annotations={
        "title": "Get Portfolio Holdings & Summary",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": True,
    },
)
async def portfolio_get_holdings(params: GetHoldingsInput, ctx=None) -> str:
    """Get current portfolio holdings with P&L, allocation, and 7-day performance.

    Returns a comprehensive view of the portfolio including per-asset holdings,
    cost basis, unrealized P&L, allocation percentages, and 7-day performance.
    This is the primary tool for answering "how's my portfolio doing?".

    Args:
        params: GetHoldingsInput with portfolio_id and response_format.

    Returns:
        str: Portfolio holdings with summary. Includes:
            - holdings: per-asset quantity, price, value, cost basis, P&L, 7d change
            - allocation: percentage breakdown by asset
            - pnlData: profit/loss sorted by absolute value
            - performance7d: 7-day price changes per asset
            - summary: totalValue, totalCost, totalPnl, totalPnlPercent, btcPrice
    """
    try:
        data = await _api_get(ctx, "/api/ticker/portfolio", {"portfolioId": params.portfolio_id})

        if params.response_format == ResponseFormat.JSON:
            return json.dumps(data, indent=2)

        summary = data.get("summary", {})
        holdings = data.get("holdings", [])

        if not holdings:
            return "Portfolio is empty - no holdings found."

        lines = [
            "# Portfolio Summary",
            "",
            f"**Total Value:** {_fmt_usd(summary.get('totalValue', 0))}",
            f"**Total Cost:** {_fmt_usd(summary.get('totalCost', 0))}",
            f"**Total P&L:** {_fmt_usd(summary.get('totalPnl', 0))} ({_fmt_pct(summary.get('totalPnlPercent', 0))})",
            f"**7d Change:** {_fmt_usd(summary.get('totalChange7d', 0))} ({_fmt_pct(summary.get('totalChange7dPercent', 0))})",
            f"**BTC Price:** {_fmt_usd(summary.get('btcPrice', 0))}",
            "",
            "## Holdings",
            "",
        ]

        for h in holdings:
            pnl_emoji = "+" if h.get("pnl", 0) >= 0 else ""
            lines.append(f"### {h['asset']}")
            lines.append(f"- Quantity: {_fmt_qty(h['quantity'])}")
            lines.append(f"- Price: {_fmt_usd(h['currentPrice'])}")
            lines.append(f"- Value: {_fmt_usd(h['currentValue'])}")
            lines.append(f"- Cost Basis: {_fmt_usd(h['costBasis'])}")
            lines.append(f"- P&L: {pnl_emoji}{_fmt_usd(h['pnl'])} ({_fmt_pct(h['pnlPercent'])})")
            lines.append(f"- 7d Change: {_fmt_pct(h.get('change7dPercent', 0))}")
            lines.append("")

        # Allocation
        allocation = data.get("allocation", [])
        if allocation:
            lines.append("## Allocation")
            lines.append("")
            for a in allocation:
                lines.append(f"- **{a['asset']}**: {a['percentage']:.1f}% ({_fmt_usd(a['value'])})")
            lines.append("")

        return "\n".join(lines)

    except Exception as e:
        return _handle_error(e)


# ---- Portfolio History ----

@mcp.tool(
    name="portfolio_get_history",
    annotations={
        "title": "Get Portfolio Value History",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": True,
    },
)
async def portfolio_get_history(params: GetHistoryInput, ctx=None) -> str:
    """Get daily portfolio value history for charting trends over time.

    Returns the total portfolio value for each day over the requested period.
    Useful for "show me how my portfolio has performed this week/month".

    Args:
        params: GetHistoryInput with portfolio_id, days, and response_format.

    Returns:
        str: Daily portfolio values as a time series.
    """
    try:
        data = await _api_get(ctx, "/api/ticker/portfolio/history", {
            "portfolioId": params.portfolio_id,
            "days": params.days,
        })

        if params.response_format == ResponseFormat.JSON:
            return json.dumps(data, indent=2)

        history = data.get("history", [])
        if not history:
            return "No portfolio history available for this period."

        lines = [f"# Portfolio Value History ({params.days} days)", ""]

        first_val = history[0]["totalValue"]
        last_val = history[-1]["totalValue"]
        change = last_val - first_val
        change_pct = (change / first_val * 100) if first_val > 0 else 0

        lines.append(f"**Period:** {history[0]['date']} to {history[-1]['date']}")
        lines.append(f"**Start:** {_fmt_usd(first_val)} | **End:** {_fmt_usd(last_val)}")
        lines.append(f"**Change:** {_fmt_usd(change)} ({_fmt_pct(change_pct)})")
        lines.append("")

        for entry in history:
            lines.append(f"- {entry['date']}: {_fmt_usd(entry['totalValue'])}")

        return "\n".join(lines)

    except Exception as e:
        return _handle_error(e)


# ---- List Portfolios ----

@mcp.tool(
    name="portfolio_list_portfolios",
    annotations={
        "title": "List Portfolios",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": True,
    },
)
async def portfolio_list_portfolios(params: ListPortfoliosInput, ctx=None) -> str:
    """List all portfolios belonging to the authenticated user.

    Returns portfolio names and IDs. Use this to discover available portfolios
    before querying holdings or transactions.

    Args:
        params: ListPortfoliosInput with response_format.

    Returns:
        str: List of portfolios with id, name, and creation date.
    """
    try:
        data = await _api_get(ctx, "/api/portfolios")

        if params.response_format == ResponseFormat.JSON:
            return json.dumps(data, indent=2)

        if not data:
            return "No portfolios found."

        lines = ["# Your Portfolios", ""]
        for p in data:
            lines.append(f"- **{p['name']}** (ID: {p['id']}) - created {p.get('createdAt', 'N/A')}")

        return "\n".join(lines)

    except Exception as e:
        return _handle_error(e)


# ---- Transactions ----

@mcp.tool(
    name="portfolio_list_transactions",
    annotations={
        "title": "List Transactions",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": True,
    },
)
async def portfolio_list_transactions(params: ListTransactionsInput, ctx=None) -> str:
    """List all transactions for a portfolio, ordered by date.

    Shows deposits, withdrawals, and swaps with full details including
    assets, quantities, prices, and fees. Useful for "show me my recent trades".

    Args:
        params: ListTransactionsInput with optional portfolio_id and response_format.

    Returns:
        str: Transaction list with type, date, assets, quantities, and prices.
    """
    try:
        query_params = {}
        if params.portfolio_id is not None:
            query_params["portfolioId"] = params.portfolio_id

        data = await _api_get(ctx, "/api/transactions", query_params)

        if params.response_format == ResponseFormat.JSON:
            return json.dumps(data, indent=2)

        if not data:
            return "No transactions found."

        lines = [f"# Transactions ({len(data)} total)", ""]

        for tx in data[-50:]:  # Show last 50 to keep response manageable
            dt = tx.get("datetime", "")[:10]
            tx_type = tx.get("type", "?")

            if tx_type == "Swap":
                from_asset = tx.get("fromAsset", "?")
                from_qty = _fmt_qty(tx.get("fromQuantity", 0))
                to_asset = tx.get("toAsset", "?")
                to_qty = _fmt_qty(tx.get("toQuantity", 0))
                desc = f"Swap {from_qty} {from_asset} -> {to_qty} {to_asset}"
            elif tx_type == "Deposit":
                desc = f"Deposit {_fmt_qty(tx.get('toQuantity', 0))} {tx.get('toAsset', '?')}"
                if tx.get("toPriceUsd"):
                    desc += f" @ {_fmt_usd(tx['toPriceUsd'])}"
            else:  # Withdrawal
                desc = f"Withdraw {_fmt_qty(tx.get('toQuantity', 0))} {tx.get('toAsset', '?')}"

            fees = f" (fees: {_fmt_usd(tx['feesUsd'])})" if tx.get("feesUsd") else ""
            notes = f" - {tx['notes']}" if tx.get("notes") else ""
            lines.append(f"- **{dt}** [{tx_type}] {desc}{fees}{notes} (ID: {tx['id']})")

        if len(data) > 50:
            lines.append(f"\n_Showing last 50 of {len(data)} transactions. Use JSON format for all._")

        return "\n".join(lines)

    except Exception as e:
        return _handle_error(e)


@mcp.tool(
    name="portfolio_add_transaction",
    annotations={
        "title": "Add Transaction",
        "readOnlyHint": False,
        "destructiveHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
)
async def portfolio_add_transaction(params: AddTransactionInput, ctx=None) -> str:
    """Add a new transaction (deposit, withdrawal, or swap) to a portfolio.

    Use this to log trades, deposits, or withdrawals. For swaps, you must
    provide from_asset, from_quantity, and from_price_usd.

    Args:
        params: AddTransactionInput with transaction details.

    Returns:
        str: Confirmation with the created transaction details.

    Examples:
        - "Log a buy of 0.5 BTC at $67000" -> Deposit, to_asset=BTC, to_quantity=0.5, to_price_usd=67000
        - "Swapped 1 ETH for 5000 ADA" -> Swap with from/to details
        - "Withdrew 1000 USDC" -> Withdrawal, to_asset=USDC, to_quantity=1000
    """
    try:
        body: Dict[str, Any] = {
            "portfolioId": params.portfolio_id,
            "type": params.type.value,
            "datetime": params.datetime,
            "toAsset": params.to_asset,
            "toQuantity": params.to_quantity,
        }
        if params.to_price_usd is not None:
            body["toPriceUsd"] = params.to_price_usd
        if params.from_asset is not None:
            body["fromAsset"] = params.from_asset
        if params.from_quantity is not None:
            body["fromQuantity"] = params.from_quantity
        if params.from_price_usd is not None:
            body["fromPriceUsd"] = params.from_price_usd
        if params.fees_usd is not None:
            body["feesUsd"] = params.fees_usd
        if params.notes is not None:
            body["notes"] = params.notes

        result = await _api_post(ctx, "/api/transactions", json_body=body)

        tx_id = result.get("id", "?")
        return (
            f"Transaction created (ID: {tx_id}). "
            f"Type: {params.type.value}, "
            f"Asset: {params.to_quantity} {params.to_asset}"
            + (f" @ {_fmt_usd(params.to_price_usd)}" if params.to_price_usd else "")
        )

    except Exception as e:
        return _handle_error(e)


@mcp.tool(
    name="portfolio_delete_transaction",
    annotations={
        "title": "Delete Transaction",
        "readOnlyHint": False,
        "destructiveHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
)
async def portfolio_delete_transaction(params: DeleteTransactionInput, ctx=None) -> str:
    """Delete a transaction by its ID. This is irreversible.

    Args:
        params: DeleteTransactionInput with the transaction ID.

    Returns:
        str: Confirmation that the transaction was deleted.
    """
    try:
        await _api_delete(ctx, "/api/transactions", {"id": params.transaction_id})
        return f"Transaction {params.transaction_id} deleted successfully."
    except Exception as e:
        return _handle_error(e)


# ---- Cash Flow ----

@mcp.tool(
    name="portfolio_get_cashflow",
    annotations={
        "title": "Get Cash Flow Analysis",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": True,
    },
)
async def portfolio_get_cashflow(params: GetCashflowInput, ctx=None) -> str:
    """Analyze money flow: deposits, withdrawals, trading volume, and net flow.

    Provides a comprehensive cash flow breakdown including total money in/out,
    bank deposits vs asset purchases, and net flow over time. Useful for
    "how much money have I put in?" or "what's my net investment?".

    Args:
        params: GetCashflowInput with portfolio_id and response_format.

    Returns:
        str: Cash flow summary with deposits, withdrawals, net flow, and yearly breakdown.
    """
    try:
        data = await _api_get(ctx, "/api/cashflow", {"portfolioId": params.portfolio_id})

        if params.response_format == ResponseFormat.JSON:
            return json.dumps(data, indent=2)

        s = data.get("summary", {})
        lines = [
            "# Cash Flow Analysis",
            "",
            "## Summary",
            f"- **Total Money In:** {_fmt_usd(s.get('totalMoneyIn', 0))}",
            f"- **Total Money Out:** {_fmt_usd(s.get('totalMoneyOut', 0))}",
            f"- **Net Flow:** {_fmt_usd(s.get('netMoneyFlow', 0))}",
            "",
            f"- Bank Deposits: {_fmt_usd(s.get('totalBankDeposits', 0))}",
            f"- Bank Withdrawals: {_fmt_usd(s.get('totalBankWithdrawals', 0))}",
            f"- Net Bank Flow: {_fmt_usd(s.get('netBankFlow', 0))}",
            "",
            f"- Asset Purchases: {_fmt_usd(s.get('totalAssetPurchases', 0))}",
            f"- Asset Sales: {_fmt_usd(s.get('totalAssetSales', 0))}",
            f"- Net Trading: {_fmt_usd(s.get('netAssetTrading', 0))}",
            "",
            f"- Taxable Events: {s.get('totalTaxableEvents', 0)}",
            f"- Total Transactions: {s.get('totalTransactions', 0)}",
        ]

        # Yearly breakdown
        yearly = data.get("yearlyFlow", {})
        if yearly:
            lines.extend(["", "## Yearly Breakdown", ""])
            for year, flow in sorted(yearly.items()):
                net = flow.get("netFlow", flow.get("totalIn", 0) - flow.get("totalOut", 0))
                lines.append(f"- **{year}**: Net {_fmt_usd(net)}")

        return "\n".join(lines)

    except Exception as e:
        return _handle_error(e)


# ---- Tax ----

@mcp.tool(
    name="portfolio_get_tax_report",
    annotations={
        "title": "Get Romania Tax Report",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": True,
    },
)
async def portfolio_get_tax_report(params: GetTaxReportInput, ctx=None) -> str:
    """Generate a Romania crypto tax report for a specific year.

    Calculates taxable events (sales, swaps, withdrawals), cost basis tracing,
    and gain/loss in both USD and RON. Supports FIFO, LIFO, HIFO, LOFO strategies.
    Use for "what's my tax liability for 2024?" or "calculate my capital gains".

    Args:
        params: GetTaxReportInput with year, portfolio_id, strategies, and format.

    Returns:
        str: Tax report with taxable events, total gains/losses in USD and RON.
    """
    try:
        query_params: Dict[str, Any] = {
            "year": str(params.year),
            "assetStrategy": params.asset_strategy.value,
            "cashStrategy": params.cash_strategy.value,
        }
        if params.portfolio_id is not None:
            query_params["portfolioId"] = str(params.portfolio_id)

        data = await _api_get(ctx, "/api/tax/romania", query_params)

        if params.response_format == ResponseFormat.JSON:
            return json.dumps(data, indent=2)

        events = data.get("taxableEvents", [])
        lines = [
            f"# Romania Tax Report - {params.year}",
            "",
            f"**Strategy:** Asset={params.asset_strategy.value}, Cash={params.cash_strategy.value}",
            "",
            "## Totals",
            f"- **Total Withdrawals (USD):** {_fmt_usd(data.get('totalWithdrawalsUsd', 0))}",
            f"- **Total Withdrawals (RON):** {data.get('totalWithdrawalsRon', 0):,.2f} RON",
            f"- **Total Cost Basis (USD):** {_fmt_usd(data.get('totalCostBasisUsd', 0))}",
            f"- **Total Cost Basis (RON):** {data.get('totalCostBasisRon', 0):,.2f} RON",
            f"- **Total Gain/Loss (USD):** {_fmt_usd(data.get('totalGainLossUsd', 0))}",
            f"- **Total Gain/Loss (RON):** {data.get('totalGainLossRon', 0):,.2f} RON",
            "",
            f"## Taxable Events ({len(events)})",
            "",
        ]

        for ev in events[:30]:  # Limit to 30 events for readability
            dt = ev.get("datetime", "")[:10]
            gain_usd = ev.get("gainLossUsd", 0)
            gain_ron = ev.get("gainLossRon", 0)
            emoji = "+" if gain_usd >= 0 else ""
            lines.append(
                f"- **{dt}** (TX #{ev.get('transactionId', '?')}): "
                f"Gain/Loss {emoji}{_fmt_usd(gain_usd)} / {emoji}{gain_ron:,.2f} RON"
            )

        if len(events) > 30:
            lines.append(f"\n_Showing 30 of {len(events)} events. Use JSON format for all._")

        return "\n".join(lines)

    except Exception as e:
        return _handle_error(e)


# ---- Prices ----

@mcp.tool(
    name="portfolio_get_prices",
    annotations={
        "title": "Get Current Crypto Prices",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": True,
    },
)
async def portfolio_get_prices(params: GetPricesInput, ctx=None) -> str:
    """Get current USD prices for one or more crypto assets.

    Fetches real-time prices from the Portfolio Tracker's price service.
    Use for "what's the price of BTC?" or "current ETH and ADA prices".

    Args:
        params: GetPricesInput with comma-separated symbols.

    Returns:
        str: Current prices per asset in USD.
    """
    try:
        data = await _api_get(ctx, "/api/prices/current", {"symbols": params.symbols})
        prices = data.get("prices", {})

        if not prices:
            return f"No prices found for: {params.symbols}"

        lines = ["# Current Prices", ""]
        for symbol, price in sorted(prices.items()):
            lines.append(f"- **{symbol}**: {_fmt_usd(price)}")

        return "\n".join(lines)

    except Exception as e:
        return _handle_error(e)


@mcp.tool(
    name="portfolio_get_price_history",
    annotations={
        "title": "Get Historical Prices",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": True,
    },
)
async def portfolio_get_price_history(params: GetPriceHistoryInput, ctx=None) -> str:
    """Get historical USD prices for assets over a date range.

    Returns daily prices between start and end timestamps. Useful for
    "what was BTC's price last month?" or backtesting analyses.

    Args:
        params: GetPriceHistoryInput with symbols, start_timestamp, end_timestamp.

    Returns:
        str: JSON array of {asset, date, price_usd} entries.
    """
    try:
        data = await _api_get(ctx, "/api/prices", {
            "symbols": params.symbols,
            "start": params.start_timestamp,
            "end": params.end_timestamp,
        })

        prices = data.get("prices", [])
        if not prices:
            return f"No historical prices found for {params.symbols} in that range."

        # Always return JSON for historical data since it can be large
        return json.dumps({"count": len(prices), "prices": prices}, indent=2)

    except Exception as e:
        return _handle_error(e)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    """Run the Portfolio MCP server via stdio transport."""
    mcp.run()


if __name__ == "__main__":
    main()
