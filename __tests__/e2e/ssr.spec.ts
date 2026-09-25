import { expect, test } from "@playwright/test";

test("concurrent requests never see each other's prefetched data", async ({ request }) => {
  const users = ["alice", "bob", "carol", "alice", "bob", "carol"];
  const pages = await Promise.all(
    users.map((user) => request.get(`/ssr?user=${user}`).then((r) => r.text())),
  );
  pages.forEach((html, i) => {
    const user = users[i];
    expect(html).toMatch(new RegExp("react-secret: (<!-- -->)?secret-for-" + user));
    expect(html).toContain(`svelte-secret: secret-for-${user}`);
    for (const other of ["alice", "bob", "carol"].filter((u) => u !== user)) {
      expect(html).not.toContain(`secret-for-${other}`);
    }
    expect(html).toContain('id="astro-tq"');
    expect(html.indexOf("astro-tq")).toBeLessThan(html.indexOf("</body>"));
  });
});
