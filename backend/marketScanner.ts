
import { ClobClient } from "./clobClient";
import { log } from "./logger";
import { ACTIVE_CONFIG } from "./config";
import { Market, Orderbook } from "../types";

const clob = new ClobClient();

export async function scanMarkets() {
  log.info("Scanning CLOB tradable markets...");
  const rawMarkets = await clob.fetchMarkets();

  const tradable = rawMarkets.filter((m: any) =>
    m.accepting_orders === true &&
    m.enable_order_book === true &&
    !m.closed &&
    !m.archived
  );

  const results: { market: Market; book: Orderbook }[] = [];

  for (const m of tradable) {
    if (results.length >= ACTIVE_CONFIG.maxMarketsPerScan) break;

    const yesToken = m.tokens?.find((t: any) => ['yes', 'true'].includes(t.outcome?.toLowerCase())) || m.tokens?.[0];
    if (!yesToken) continue;

    const book = await clob.fetchOrderbook(yesToken.token_id);
    if (!book) continue;

    const market: Market = {
      id: m.condition_id,
      question: m.question,
      description: m.description || m.question,
      yesTokenId: yesToken.token_id,
      noTokenId: m.tokens?.[1]?.token_id || yesToken.token_id,
      currentPrice: book.midPrice,
      outcomes: m.tokens.map((t: any) => t.outcome),
      lastUpdated: Date.now(),
      acceptingOrders: true,
      enableOrderBook: true,
      category: 'General',
      volume: 0
    };

    results.push({ market, book });
  }

  log.info(`Scanner: Found ${results.length} operable candidates`);
  return results;
}
