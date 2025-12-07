#!/bin/bash
# ============================================================
# Smoke Test Script for Trading212 + Yahoo Finance Integration
# ============================================================
# Run with: npm run smoke:test
# Requires: curl, dev server running on localhost:3000
# ============================================================

BASE_URL="http://localhost:3000"
PASS_COUNT=0
FAIL_COUNT=0
FAILED_ENDPOINTS=()

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo ""
echo "============================================================"
echo "  Trading212 + Yahoo Finance Integration Smoke Test"
echo "============================================================"
echo "  Base URL: $BASE_URL"
echo "  Time: $(date)"
echo "============================================================"
echo ""

# Function to test an endpoint
test_endpoint() {
    local path="$1"
    local description="$2"
    
    echo -e "${CYAN}=== Testing $path ===${NC}"
    echo "    $description"
    
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 "$BASE_URL$path")
    
    if [ "$code" == "200" ]; then
        echo -e "    ${GREEN}[PASS]${NC} $path (${code})"
        ((PASS_COUNT++))
    else
        echo -e "    ${RED}[FAIL]${NC} $path (${code})"
        ((FAIL_COUNT++))
        FAILED_ENDPOINTS+=("$path|$code")
    fi
    echo ""
}

echo "------------------------------------------------------------"
echo "  1. Trading212 API Wrappers"
echo "------------------------------------------------------------"
echo ""

test_endpoint "/api/t212/account/summary" "Account summary (balance, equity, etc.)"
test_endpoint "/api/t212/account/cash" "Account cash balances"
test_endpoint "/api/t212/positions" "Current open positions"
test_endpoint "/api/t212/history/orders?limit=5" "Historical orders (last 5)"
test_endpoint "/api/t212/history/dividends?limit=5" "Dividend history (last 5)"
test_endpoint "/api/t212/history/transactions?limit=5" "Transaction history (last 5)"
test_endpoint "/api/t212/metadata/instruments" "Tradable instruments list"

echo "------------------------------------------------------------"
echo "  2. Yahoo Finance + Canonical History"
echo "------------------------------------------------------------"
echo ""

test_endpoint "/api/history/sync/TSLA" "Sync TSLA history from Yahoo"
test_endpoint "/api/history/TSLA" "Retrieve TSLA canonical history"

echo "------------------------------------------------------------"
echo "  3. Trading212 Trades (Paired)"
echo "------------------------------------------------------------"
echo ""

test_endpoint "/api/t212/trades/TSLA_US_EQ" "Raw trades for TSLA"
test_endpoint "/api/t212/trades/TSLA_US_EQ/paired" "FIFO-paired trades for TSLA"

echo "------------------------------------------------------------"
echo "  4. Key Pages"
echo "------------------------------------------------------------"
echo ""

test_endpoint "/t212" "Trading212 Dashboard page"
test_endpoint "/company/TSLA/timing" "TSLA Timing page"

echo "============================================================"
echo "  SUMMARY"
echo "============================================================"
echo ""
echo -e "  ${GREEN}PASSED:${NC} $PASS_COUNT"
echo -e "  ${RED}FAILED:${NC} $FAIL_COUNT"
echo ""

if [ $FAIL_COUNT -gt 0 ]; then
    echo -e "${YELLOW}Failed Endpoints:${NC}"
    for item in "${FAILED_ENDPOINTS[@]}"; do
        IFS='|' read -r endpoint code <<< "$item"
        echo -e "  ${RED}✗${NC} $endpoint → HTTP $code"
        
        # Provide hints based on status code
        case $code in
            000)
                echo "    └─ Hint: Server not running? Check npm run dev"
                ;;
            401|403)
                echo "    └─ Hint: Check T212_API_KEY_ID and T212_API_SECRET in .env.local"
                ;;
            404)
                echo "    └─ Hint: Route may not exist or ticker not found"
                ;;
            429)
                echo "    └─ Hint: Rate limited - wait a moment and retry"
                ;;
            500)
                echo "    └─ Hint: Server error - check terminal for stack trace"
                ;;
        esac
    done
    echo ""
    exit 1
else
    echo -e "${GREEN}All endpoints passed! ✓${NC}"
    echo ""
    exit 0
fi
