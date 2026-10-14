import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ExternalReportRequestPanel, PlayerDqRequestPanel } from "./BracketTab";
import type { FeatureMessage } from "../domain/messages";

const request: FeatureMessage = {
  messageId: "request", threadId: "unused", parentMessageId: null, messageType: "normal",
  method: "external_edit_request", destination: "bracket", messageMeta: null,
  subject: "Request", body: "Request", senderName: "Latest Reporter", senderUserId: "87654321",
  senderIp: "192.168.1.20", createdAt: "2026-10-14T00:00:00Z",
};

describe("pool external report request panel", () => {
  it("shows the applicant and both response actions in the pool", () => {
    const html = renderToStaticMarkup(
      <ExternalReportRequestPanel request={request} canAccept canRespond onAccept={vi.fn()} onReject={vi.fn()} />,
    );
    expect(html).toContain("外部報告申請が届いています");
    expect(html).toContain('class="external-report-request-row"');
    expect(html).toContain('class="external-report-request-actions"');
    expect(html).toContain("Latest Reporter");
    expect(html).toContain("87654321");
    expect(html).toContain(">受理</button>");
    expect(html).toContain(">拒否</button>");
    expect(html).not.toContain("disabled");
  });

  describe("pool DQ request panel", () => {
    it("offers explicit confirmation instead of applying or hiding the request on opening", () => {
      const secondRequest = { ...request, messageId: "request-2", body: "Second DQ reason" };
      const html = renderToStaticMarkup(
        <PlayerDqRequestPanel
          requests={[{ ...request, body: "DQ reason" }, secondRequest]}
          busy={false}
          onProcess={vi.fn()}
        />,
      );
      expect(html).toContain("DQ申請が届いています");
      expect(html).toContain("DQ reason");
      expect(html).toContain("Second DQ reason");
      expect(html.match(/class="dq-request-row"/g)).toHaveLength(2);
      expect(html).toContain("Latest Reporter");
      expect(html).toContain(">DQ内容を確認</button>");
      expect(html).toContain("開くだけでは申請は処理済みになりません");
    });
    it("does not render processed requests and disables opening while busy", () => {
      expect(renderToStaticMarkup(<PlayerDqRequestPanel requests={[]} busy={false} onProcess={vi.fn()} />)).toBe("");
      expect(renderToStaticMarkup(<PlayerDqRequestPanel requests={[request]} busy onProcess={vi.fn()} />)).toContain('disabled=""');
    });
  });
  it("disables actions when communication or authorization is unavailable", () => {
    const html = renderToStaticMarkup(
      <ExternalReportRequestPanel request={request} canAccept={false} canRespond={false} onAccept={vi.fn()} onReject={vi.fn()} />,
    );
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
  it("does not show a panel when no request is pending", () => {
    expect(renderToStaticMarkup(
      <ExternalReportRequestPanel request={null} canAccept canRespond onAccept={vi.fn()} onReject={vi.fn()} />,
    )).toBe("");
  });
});
