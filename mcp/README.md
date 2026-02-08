# Portfolio MCP Server

An MCP (Model Context Protocol) server that provides conversational access to your **Portfolio Tracker Web** data. Query holdings, P&L, transactions, cash flow, tax reports, and crypto prices through any MCP-compatible client (Claude Desktop, Claude Code, etc.).

## Features

| Tool | Description |
|------|-------------|
| `portfolio_get_holdings` | Holdings with P&L, allocation, 7-day performance |
| `portfolio_get_history` | Portfolio value history for trend analysis |
| `portfolio_list_portfolios` | List all portfolios |
| `portfolio_list_transactions` | View transaction history |
| `portfolio_add_transaction` | Log deposits, withdrawals, swaps |
| `portfolio_delete_transaction` | Remove a transaction |
| `portfolio_get_cashflow` | Money flow analysis (in/out/net) |
| `portfolio_get_tax_report` | Romania tax report (FIFO/LIFO/HIFO/LOFO) |
| `portfolio_get_prices` | Current crypto prices |
| `portfolio_get_price_history` | Historical price data |

## Prerequisites

1. **Portfolio Tracker Web** running (locally or remotely)
2. An **API key** generated from your Portfolio Tracker account settings
3. Python 3.10+

## Installation

```bash
cd portfolio-mcp
pip install -e .
```

## Configuration

Set two environment variables:

```bash
export PORTFOLIO_API_URL="http://localhost:3000"   # Your Portfolio Tracker URL
export PORTFOLIO_API_KEY="tk_your_api_key_here"    # Your API key
```

## Usage with Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "portfolio": {
      "command": "python",
      "args": ["-m", "portfolio_mcp.server"],
      "env": {
        "PORTFOLIO_API_URL": "http://localhost:3000",
        "PORTFOLIO_API_KEY": "tk_your_api_key_here"
      }
    }
  }
}
```

## Usage with Claude Code

```bash
claude mcp add portfolio -- python -m portfolio_mcp.server
```

Then set the environment variables in your shell before launching Claude Code.

## Example Conversations

- "How's my portfolio doing?"
- "What's my total P&L?"
- "Show me my BTC and ETH holdings"
- "Log a buy of 0.5 BTC at $67,000"
- "What's my tax liability for 2024 using HIFO strategy?"
- "How much money have I invested total?"
- "What's the current price of ADA?"
- "Show my portfolio performance over the last 30 days"

## Portfolio-web API Key Auth Extension

This MCP server requires API key authentication on **all** Portfolio-web endpoints (not just the `/api/ticker/*` ones). The required change has been made to `src/lib/auth.ts` in your Portfolio Tracker Web — the `getServerAuth()` function now accepts both session cookies AND `X-API-Key` header authentication as a fallback.
