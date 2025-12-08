import {
  getAccountSummary,
  getAccountCash,
  getPositions,
} from "@/lib/trading212/client";

export const dynamic = "force-dynamic";

export default async function Trading212Page() {
  const [summary, cash, positions] = await Promise.all([
    getAccountSummary(),
    getAccountCash(),
    getPositions(),
  ]);

  return (
    <main className="min-h-screen bg-background text-foreground px-6 py-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <header className="flex items-baseline justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Trading212 Account</h1>
            <p className="text-sm text-slate-400">
              Account ID {summary.id} · Currency {summary.currency}
            </p>
          </div>
        </header>

        {/* Account summary */}
        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h2 className="text-sm font-medium text-slate-300">Total value</h2>
            <p className="mt-2 text-2xl font-semibold">
              {summary.totalValue.toLocaleString(undefined, {
                style: "currency",
                currency: summary.currency,
              })}
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h2 className="text-sm font-medium text-slate-300">Investments</h2>
            <p className="mt-1 text-sm text-slate-400">Current value</p>
            <p className="text-lg font-semibold">
              {summary.investments.currentValue.toLocaleString(undefined, {
                style: "currency",
                currency: summary.currency,
              })}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Cost basis{" "}
              {summary.investments.totalCost.toLocaleString(undefined, {
                style: "currency",
                currency: summary.currency,
              })}
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h2 className="text-sm font-medium text-slate-300">P&amp;L</h2>
            <p className="mt-1 text-xs text-slate-400">Unrealised</p>
            <p className="text-lg font-semibold">
              {summary.investments.unrealizedProfitLoss.toLocaleString(
                undefined,
                { style: "currency", currency: summary.currency }
              )}
            </p>
            <p className="mt-1 text-xs text-slate-400">Realised</p>
            <p className="text-sm">
              {summary.investments.realizedProfitLoss.toLocaleString(
                undefined,
                { style: "currency", currency: summary.currency }
              )}
            </p>
          </div>
        </section>

        {/* Cash breakdown */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h2 className="text-sm font-medium text-slate-300 mb-3">
            Cash breakdown
          </h2>
          <dl className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6 text-sm">
            <div>
              <dt className="text-slate-500">Free</dt>
              <dd>
                {cash.free.toLocaleString(undefined, {
                  style: "currency",
                  currency: summary.currency,
                })}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Blocked</dt>
              <dd>
                {cash.blocked.toLocaleString(undefined, {
                  style: "currency",
                  currency: summary.currency,
                })}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Invested</dt>
              <dd>
                {cash.invested.toLocaleString(undefined, {
                  style: "currency",
                  currency: summary.currency,
                })}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Pie cash</dt>
              <dd>
                {cash.pieCash.toLocaleString(undefined, {
                  style: "currency",
                  currency: summary.currency,
                })}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Result</dt>
              <dd>
                {cash.result.toLocaleString(undefined, {
                  style: "currency",
                  currency: summary.currency,
                })}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Total</dt>
              <dd>
                {cash.total.toLocaleString(undefined, {
                  style: "currency",
                  currency: summary.currency,
                })}
              </dd>
            </div>
          </dl>
        </section>

        {/* Positions table */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-slate-300">
              Open positions
            </h2>
            <p className="text-xs text-slate-500">
              {positions.length} instrument{positions.length === 1 ? "" : "s"}
            </p>
          </div>

          {positions.length === 0 ? (
            <p className="text-sm text-slate-500">No open positions.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-slate-800 text-slate-400">
                  <tr>
                    <th className="py-2 pr-4 text-left">Ticker</th>
                    <th className="py-2 pr-4 text-left">Name</th>
                    <th className="py-2 pr-4 text-right">Quantity</th>
                    <th className="py-2 pr-4 text-right">Price</th>
                    <th className="py-2 pr-4 text-right">Current value</th>
                    <th className="py-2 pr-4 text-right">Unrealised P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => (
                    <tr
                      key={p.instrument.ticker}
                      className="border-b border-slate-900/60"
                    >
                      <td className="py-2 pr-4 font-mono text-xs">
                        {p.instrument.ticker}
                      </td>
                      <td className="py-2 pr-4">{p.instrument.name}</td>
                      <td className="py-2 pr-4 text-right">
                        {p.quantity.toLocaleString()}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {p.currentPrice.toLocaleString(undefined, {
                          style: "currency",
                          currency: p.instrument.currency,
                        })}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {p.walletImpact.currentValue.toLocaleString(undefined, {
                          style: "currency",
                          currency: p.walletImpact.currency,
                        })}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {p.walletImpact.unrealizedProfitLoss.toLocaleString(
                          undefined,
                          {
                            style: "currency",
                            currency: p.walletImpact.currency,
                          }
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
