import { getRainGrid } from "@/lib/weather/rain-grid";

// GET → the current forecast rain grid (mm/h, 15-minute steps, ~4 h)
export async function GET() {
  try {
    const grid = await getRainGrid();
    return Response.json(grid, {
      headers: { "Cache-Control": "public, max-age=300, s-maxage=600" },
    });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 503 });
  }
}
