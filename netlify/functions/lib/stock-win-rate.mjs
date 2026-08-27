// netlify/functions/lib/stock-win-rate.mjs
//
// 「個股勝率排行」：跨多個訊號日，把同一支股票每次被選進 Top N 觀察榜、實際進場的交易
// 彙總起來，算出「這支股票被選中後，操作結果是贏的比例有多高」，而不是像 backtest.mjs
// 那樣只看「某一天整批 10 檔」的勝率。
//
// 這兩種勝率回答的是不同問題：
//   - backtest.mjs 的勝率：「今天這套四因子模型選出的 Top 10，整體表現好不好」
//   - 這裡的勝率：「這支特定股票，過去每次被模型選中時，事後看是不是常常獲利」
// 後者容易被「樣本數太小」誤導——一支股票如果只出現過 1 次、剛好贏了，勝率就是 100%，
// 但這個 100% 沒有統計意義。所以排行一定要搭配最小樣本數門檻，並把樣本數本身也列出來，
// 不能只看勝率數字。

/**
 * 把多個訊號日的完整回測結果，彙總成「每支股票」的交易統計（基準策略跟高級策略分開算，
 * 因為兩者的進出場規則不同，同一天同一支股票在兩套策略下的輸贏可能不一樣）。
 *
 * @param {Array<Object|null>} results getBacktestResultByDate() 回傳的完整回測結果陣列
 *   （必須含 trades 明細，不能是 summarizeBacktest() 之後的摘要版——摘要版已經把 trades 濾掉了）
 * @returns {Map<string, {code:string, name:string, lastSeenDate:string|null,
 *   base:{trades:number, wins:number, sumNetReturn:number},
 *   adv:{trades:number, wins:number, sumNetReturn:number}}>}
 */
export function buildStockStats(results) {
  const map = new Map();

  function ensure(code) {
    if (!map.has(code)) {
      map.set(code, {
        code,
        name: '',
        lastSeenDate: null,
        base: { trades: 0, wins: 0, sumNetReturn: 0 },
        adv: { trades: 0, wins: 0, sumNetReturn: 0 },
      });
    }
    return map.get(code);
  }

  function absorb(trades, date, bucketKey) {
    for (const trade of trades ?? []) {
      if (!trade?.code || typeof trade.netReturnPercent !== 'number' || !Number.isFinite(trade.netReturnPercent)) continue;
      const entry = ensure(trade.code);
      if (trade.name && !entry.name) entry.name = trade.name;
      if (date && (!entry.lastSeenDate || date > entry.lastSeenDate)) entry.lastSeenDate = date;

      const bucket = entry[bucketKey];
      bucket.trades += 1;
      if (trade.netReturnPercent > 0) bucket.wins += 1;
      bucket.sumNetReturn += trade.netReturnPercent;
    }
  }

  for (const result of results ?? []) {
    if (!result) continue;
    const date = result.executionDate ?? result.signalDate ?? null;
    absorb(result.trades, date, 'base');
    absorb(result.adv?.trades, date, 'adv');
  }

  return map;
}

/**
 * 把 buildStockStats() 的結果轉成排行榜：依勝率由高到低排序，並用最小樣本數門檻濾掉
 * 「只出現過一兩次剛好贏了」這種沒有統計意義的個股。
 *
 * 排序規則：勝率優先；勝率相同時樣本數多的排前面（樣本數大代表這個勝率比較可信，
 * 不是單純運氣好）；再相同才比平均報酬率。
 *
 * @param {Map} stockStatsMap buildStockStats() 的回傳值
 * @param {{strategy?: 'base'|'adv', minTrades?: number, limit?: number}} [options]
 * @returns {Array<{code:string, name:string, trades:number, wins:number,
 *   winRatePercent:number, avgNetReturnPercent:number, lastSeenDate:string|null}>}
 */
export function rankStocksByWinRate(stockStatsMap, options = {}) {
  const { strategy = 'base', minTrades = 3, limit = 30 } = options;

  const list = [...(stockStatsMap?.values() ?? [])]
    .map((entry) => {
      const bucket = entry[strategy] ?? { trades: 0, wins: 0, sumNetReturn: 0 };
      const winRatePercent = bucket.trades === 0 ? null : (bucket.wins / bucket.trades) * 100;
      const avgNetReturnPercent = bucket.trades === 0 ? null : bucket.sumNetReturn / bucket.trades;
      return {
        code: entry.code,
        name: entry.name,
        trades: bucket.trades,
        wins: bucket.wins,
        winRatePercent,
        avgNetReturnPercent,
        lastSeenDate: entry.lastSeenDate,
      };
    })
    .filter((s) => s.trades >= minTrades)
    .sort((a, b) => {
      if (b.winRatePercent !== a.winRatePercent) return (b.winRatePercent ?? -1) - (a.winRatePercent ?? -1);
      if (b.trades !== a.trades) return b.trades - a.trades;
      return (b.avgNetReturnPercent ?? -Infinity) - (a.avgNetReturnPercent ?? -Infinity);
    });

  return list.slice(0, limit);
}
