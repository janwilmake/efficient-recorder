/// <reference types="@cloudflare/workers-types" />
export interface Env {
  DB: D1Database;
}

interface HistoryItem {
  url: string;
  visitedAt: number;
  nextVisitedAt: number | null;
  title: string;
  datetime: string;
  duration: number | null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Handle GET /
    if (request.method === "GET" && url.pathname === "/") {
      if (!request.url?.startsWith("http://localhost:")) {
        return new Response("The GET endpoint only works locally", {
          status: 401,
        });
      }

      return handleGetAll(env.DB);
    }
    // Handle POST /insert
    if (request.method === "POST" && url.pathname === "/insert") {
      console.log("entered /insert");
      return handleInsert(request, env.DB);
    }

    // Return 404 for other routes
    return new Response("Not Found", { status: 404 });
  },
};

async function handleGetAll(db: D1Database): Promise<Response> {
  try {
    // Query all items from the database
    const { results } = await db
      .prepare("SELECT * FROM history")
      .all<HistoryItem>();

    // Return the items as a JSON response
    return new Response(JSON.stringify(results, undefined, 2), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in /:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
async function handleInsert(
  request: Request,
  db: D1Database,
): Promise<Response> {
  try {
    // Parse the request body as an array of HistoryItem
    const items: HistoryItem[] = await request.json();

    // Ensure the table exists
    const res = await db
      .prepare(
        `
        CREATE TABLE IF NOT EXISTS history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          url TEXT NOT NULL,
          visitedAt INTEGER NOT NULL,
          nextVisitedAt INTEGER,
          title TEXT NOT NULL,
          datetime TEXT NOT NULL,
          duration INTEGER
        )
      `,
      )
      .bind()
      .run();

    console.log({ res });
    // Query the latest item in the database
    const latestItem = await db
      .prepare("SELECT * FROM history ORDER BY visitedAt DESC LIMIT 1")
      .first<HistoryItem>();

    // Filter items to insert only those after the latest item
    const itemsToInsert = latestItem
      ? items.filter((item) => item.visitedAt > latestItem.visitedAt)
      : items;

    console.log({ latestItem, itemsToInsert: itemsToInsert.length });

    // Insert new items into the database
    if (itemsToInsert.length > 0) {
      const stmt = db.prepare(`
          INSERT INTO history (url, visitedAt, nextVisitedAt, title, datetime, duration)
          VALUES (?, ?, ?, ?, ?, ?);
        `);

      // Batch insert all items
      const results = await db.batch(
        itemsToInsert.map((item) =>
          stmt.bind(
            item.url,
            item.visitedAt,
            item.nextVisitedAt,
            item.title,
            item.datetime,
            item.duration,
          ),
        ),
      );
      console.log({ results });
    }
    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        inserted: itemsToInsert.length,
        latestItem: latestItem || null,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error in /insert:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
