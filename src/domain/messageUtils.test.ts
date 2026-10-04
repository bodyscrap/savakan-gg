import { describe, expect, it } from "vitest";
import type { GenericMessage } from "../components/MessageBox";
import {
	buildCallTargetId,
	canBroadcastCallListSync,
	extractCallTargetIdentityFromMeta,
	getExternalEditRequest,
	getExternalScoreReport,
	isMessageForScope,
	formatSenderProfileLabel,
	hasSenderIdCollision,
	isSameCallTargetIdentity,
	isSenderProfileReadyForMessaging,
	normalizeSenderUserId,
	resolveSenderSettingsStatus,
} from "./messageUtils";

const externalEditRequestMessage: GenericMessage = {
  messageId: "message-1",
  threadId: "thread-1",
  parentMessageId: null,
  messageType: "normal",
  messageMeta: {
    externalEditRequest: true,
    externalEditTournamentId: "tournament-1",
    externalEditSlug: "tournament-slug",
    externalEditEventId: "event-1",
    externalEditEventName: "Event",
    externalEditPhaseName: "Phase 1",
    externalEditPhaseGroupId: "group-1",
    externalEditPhaseGroupName: "Pool A",
    externalEditPhaseGroupDisplayIdentifier: "A",
    externalEditorName: "Operator",
    externalEditorSenderUserId: "12345678",
  },
  method: "external_edit_request",
  subject: "External edit request",
  senderName: "Operator",
  senderUserId: "12345678",
  senderIp: "192.168.1.20",
  body: "Please accept",
  createdAt: "2025-01-01T00:00:00.000Z",
};

const validProfile = {
	senderName: "Operator",
	senderUserId: "12345678",
	bindIp: "192.168.1.20",
	broadcastSubnetMask: "255.255.255.0",
};

describe("call target identity", () => {
	it("uses event, set, and normalized player ID as the complete call ID", () => {
		const identity = extractCallTargetIdentityFromMeta({
			scopeEventId: "event-1",
			scopeTournamentId: "tournament-1",
			scopePhaseName: "Phase 1",
			scopePhaseGroupName: "Pool A",
			setId: "set-1",
			playerId: " pg-player ",
			callEntrantId: "entrant-1",
		});

		expect(identity).toEqual({
			eventId: "event-1",
			setId: "set-1",
			playerId: "PG-PLAYER",
		});
		if (!identity) {
			throw new Error("Expected a call target identity");
		}
		expect(buildCallTargetId(" event-1 ", " set-1 ", "pg-player")).toBe("event-1::set-1::PG-PLAYER");
		expect(isSameCallTargetIdentity(identity, {
			eventId: "event-1",
			setId: "set-1",
			playerId: "PG-PLAYER",
		})).toBe(true);
	});

	it("does not match calls for another event, set, or player", () => {
		const identity = {
			eventId: "event-1",
			setId: "set-1",
			playerId: "PG-PLAYER",
		};

		expect(isSameCallTargetIdentity(identity, { ...identity, eventId: "event-2" })).toBe(false);
		expect(isSameCallTargetIdentity(identity, { ...identity, setId: "set-2" })).toBe(false);
		expect(isSameCallTargetIdentity(identity, { ...identity, playerId: "PG-OTHER" })).toBe(false);
		expect(extractCallTargetIdentityFromMeta({
			eventId: "event-1",
			setId: "set-1",
			callEntrantId: "entrant-1",
		})).toBeNull();
	});
});

describe("sender messaging readiness", () => {
	it("normalizes sender IDs to at most eight digits", () => {
		expect(normalizeSenderUserId("12a34567890")).toBe("12345678");
		expect(normalizeSenderUserId("abc")).toBe("");
	});

	it("requires a name, valid sender ID, and bind IP", () => {
		expect(isSenderProfileReadyForMessaging(validProfile)).toBe(true);
		expect(isSenderProfileReadyForMessaging({ ...validProfile, senderName: "  " })).toBe(false);
		expect(isSenderProfileReadyForMessaging({ ...validProfile, senderUserId: "1234" })).toBe(false);
		expect(isSenderProfileReadyForMessaging({ ...validProfile, bindIp: "invalid" })).toBe(false);
	});

	it("requires communication to be enabled and a valid subnet for call-list broadcast", () => {
		expect(canBroadcastCallListSync(validProfile, false)).toBe(true);
		expect(canBroadcastCallListSync(validProfile, true)).toBe(false);
		expect(canBroadcastCallListSync({ ...validProfile, broadcastSubnetMask: "invalid" }, false)).toBe(false);
	});

	it("formats sender labels with fallbacks for invalid identity and IP values", () => {
		expect(formatSenderProfileLabel(validProfile)).toBe("Operator / 12345678 / IP: 192.168.1.20");
		expect(formatSenderProfileLabel({ ...validProfile, senderName: "", senderUserId: "bad", bindIp: "bad" }))
			.toBe("未設定 / 未設定 / IP: 未設定");
	});

	it("detects a sender ID used by a different sender name", () => {
		const messages = [{ senderUserId: "12345678", senderName: "Other" }];
		expect(hasSenderIdCollision(messages, "12345678", "Operator")).toBe(true);
		expect(hasSenderIdCollision(messages, "12345678", "Other")).toBe(false);
		expect(hasSenderIdCollision(messages, "invalid", "Operator")).toBe(false);
	});

	it("prioritizes collision, identity warning, network selection, and IP validation", () => {
		const valid = {
			senderIdCollision: false,
			shouldRecommendMailboxClear: false,
			hasSelectedNetworkDevice: true,
			bindIp: "192.168.1.20",
			broadcastSubnetMask: "255.255.255.0",
		};

		expect(resolveSenderSettingsStatus({ ...valid, senderIdCollision: true }))
			.toBe("既存履歴で同一IDが別名義に使われています。");
		expect(resolveSenderSettingsStatus({ ...valid, senderIdCollision: true, shouldRecommendMailboxClear: true }))
			.toBe("既存履歴で同一IDが別名義に使われています。");
		expect(resolveSenderSettingsStatus({ ...valid, shouldRecommendMailboxClear: true }))
			.toContain("強制クリアを推奨");
		expect(resolveSenderSettingsStatus({ ...valid, hasSelectedNetworkDevice: false }))
			.toBe("ネットワークデバイスを選択してください。");
		expect(resolveSenderSettingsStatus({ ...valid, bindIp: "invalid" }))
			.toBe("選択デバイスのIPが不正です。");
		expect(resolveSenderSettingsStatus(valid))
			.toBe("デバイス選択後、IP/サブネットは自動適用されます。");
	});
});

describe("external edit requests", () => {
	it("extracts a complete request when its sender metadata matches the message", () => {
		expect(getExternalEditRequest(externalEditRequestMessage)).toEqual({
			tournamentId: "tournament-1",
			slug: "tournament-slug",
			eventId: "event-1",
			eventName: "Event",
			phaseName: "Phase 1",
			phaseGroupId: "group-1",
			phaseGroupName: "Pool A",
			phaseGroupDisplayIdentifier: "A",
		});

	});

	it("rejects malformed, replied-to, or sender-mismatched requests", () => {
		expect(getExternalEditRequest({
			...externalEditRequestMessage,
			messageMeta: { ...externalEditRequestMessage.messageMeta, externalEditorSenderUserId: "87654321" },
		})).toBeNull();
		expect(getExternalEditRequest({
			...externalEditRequestMessage,
			parentMessageId: "parent-1",
		})).toBeNull();
		expect(getExternalEditRequest({
			...externalEditRequestMessage,
			messageMeta: { externalEditRequest: true },
		})).toBeNull();
	});
});

describe("external score reports", () => {
	const reportMessage: GenericMessage = {
		...externalEditRequestMessage,
		messageMeta: {
			externalScoreReport: true,
			externalScoreReportTournamentId: "tournament-1",
			externalScoreReportSlug: "tournament-slug",
			externalScoreReportEventId: "event-1",
			externalScoreReportEventName: "Event",
			externalScoreReportPhaseName: "Phase 1",
			externalScoreReportPhaseGroupId: "group-1",
			externalScoreReportPhaseGroupName: "Pool A",
			externalScoreReportSetId: "set-1",
			externalScoreReportWinnerId: "entrant-1",
			externalScoreReportDirectWin: false,
			externalScoreReportSlotScores: [
				{ entrantId: "entrant-1", score: 2 },
				{ entrantId: "entrant-2", score: 1 },
			],
		},
		method: "external_score_report",
	};

	it("extracts a complete confirmed result report", () => {
		expect(getExternalScoreReport(reportMessage)).toEqual({
			tournamentId: "tournament-1",
			slug: "tournament-slug",
			eventId: "event-1",
			eventName: "Event",
			phaseName: "Phase 1",
			phaseGroupId: "group-1",
			phaseGroupName: "Pool A",
			setId: "set-1",
			winnerId: "entrant-1",
			directWin: false,
			slotScores: [
				{ entrantId: "entrant-1", score: 2 },
				{ entrantId: "entrant-2", score: 1 },
			],
		});
	});

	it("rejects incomplete rosters and reports sent as replies", () => {
		expect(getExternalScoreReport({
			...reportMessage,
			messageMeta: {
				...reportMessage.messageMeta,
				externalScoreReportSlotScores: [{ entrantId: "entrant-1", score: 2 }],
			},
		})).toBeNull();
		expect(getExternalScoreReport({
			...reportMessage,
			parentMessageId: "parent-1",
		})).toBeNull();
	});

	it("uses tournament, event, and set identifiers without requiring sender-side labels", () => {
		expect(getExternalScoreReport({
			...reportMessage,
			messageMeta: {
				externalScoreReport: true,
				externalScoreReportTournamentId: "tournament-1",
				externalScoreReportEventId: "event-1",
				externalScoreReportSetId: "set-1",
				externalScoreReportWinnerId: "entrant-1",
				externalScoreReportDirectWin: false,
				externalScoreReportSlotScores: [
					{ entrantId: "entrant-1", score: 2 },
					{ entrantId: "entrant-2", score: 1 },
				],
			},
		})).not.toBeNull();
		expect(isMessageForScope({
			...reportMessage,
			messageMeta: {
				...reportMessage.messageMeta,
				scopeTournamentId: "tournament-1",
				scopeSlug: "sender-side-slug",
				scopeEventId: "event-1",
				scopePhaseName: "different phase label",
				scopePhaseGroupName: "different pool label",
			},
		}, {
			tournamentId: "tournament-1",
			slug: "receiver-side-slug",
			eventId: "event-1",
			phaseName: "Phase 1",
			phaseGroupName: "Pool A",
		})).toBe(true);
	});
});