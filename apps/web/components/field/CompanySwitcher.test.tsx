import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/field/map",
  useRouter: () => ({ push: () => {} }),
}));

import { OperatingSelectorControls } from "./CompanySwitcher";

const render = (open: boolean, company: "2u" | "gitlab-current" = "gitlab-current") =>
  renderToStaticMarkup(
    <OperatingSelectorControls
      selection={{ company, scenario: "late-payments" }}
      onChange={() => {}}
      defaultOpen={open}
    />,
  );

describe("combined company and scenario picker", () => {
  it("is one menu button that shows the full name, subtitle and scenario", () => {
    const html = render(false);
    expect(html).not.toContain("<select");
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Company and scenario: ");
    expect(html).toContain(">CodeHarbor<");
    expect(html).toContain("Inspired by GitLab · </span>Late payments");
    expect(html).not.toContain("(inspired by");
    expect(html).toContain("focus-visible:ring-ring");
    expect(html).not.toContain('role="menu"');
  });

  it("opens to grouped radio items with the current company and scenario checked", () => {
    const html = render(true, "2u");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('role="menu"');
    expect(html.match(/role="menuitemradio"/g)).toHaveLength(7);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(2);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(7);
    expect(html).toContain("2U (historical)");
    expect(html).toContain("Taskline");
    expect(html).toContain('href="/case/2u"');
    const groups = [...html.matchAll(/role="group" aria-labelledby="([^"]+)"/g)].map((m) => m[1]);
    expect(groups).toHaveLength(2);
    for (const id of groups)
      expect(html).toMatch(new RegExp(`id="${id}"[^>]*>(Company|Scenario)<`));
  });
});
