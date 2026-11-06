import { describe, expect, it, vi } from "vitest";
import { webSearchTool } from "./search";

describe("browser search", () => {
  it("sends the key only to Tavily and gives the model bounded results and safe source URLs", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ results: [
      { url: "https://example.org/", title: "Reference", content: "x".repeat(9000) },
      { url: "javascript:alert(1)", title: "Unsafe" },
    ] })));
    const ctrl = new AbortController();
    const result = await webSearchTool("private-key", f).execute({ query: " nets " }, ctrl.signal);
    expect(f).toHaveBeenCalledWith("https://api.tavily.com/search", expect.objectContaining({ signal: ctrl.signal, headers: { "content-type": "application/json", authorization: "Bearer private-key" } }));
    expect(JSON.parse(f.mock.calls[0]![1]!.body as string)).toMatchObject({ query: "nets", max_results: 5, include_raw_content: false });
    expect(result.sources).toEqual([{ url: "https://example.org/", title: "Reference" }]);
    expect(result.content).not.toContain("private-key");
    expect(JSON.parse(result.content).results[0].content).toHaveLength(6000);
    expect(JSON.parse(result.content).note).toContain("Untrusted");
  });

  it("doesn't send malformed or excessive queries", async () => {
    const f = vi.fn<typeof fetch>();
    const tool = webSearchTool("key", f);
    for (const input of [null, {}, { query: " " }, { query: 12 }, { query: "x".repeat(1001) }]) await expect(tool.execute(input)).rejects.toThrow("query");
    expect(f).not.toHaveBeenCalled();
  });

  it("reports auth errors without echoing the service's response or key", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response("private-key", { status: 401 }));
    await expect(webSearchTool("private-key", f).execute({ query: "nets" })).rejects.toThrow("Check it in Providers and keys");
    await expect(webSearchTool("private-key", f).execute({ query: "nets" })).rejects.not.toThrow("private-key");
  });
});
