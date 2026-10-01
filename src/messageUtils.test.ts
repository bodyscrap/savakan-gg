import { describe, expect, it } from "vitest";
import {
	canBroadcastCallListSync,
	hasSenderIdCollision,
	isSenderProfileReadyForMessaging,
	normalizeSenderUserId,
} from "./messageUtils";

const validProfile = {
	senderName: "Operator",
	senderUserId: "12345678",
	bindIp: "192.168.1.20",
	broadcastSubnetMask: "255.255.255.0",
};

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

	it("detects a sender ID used by a different sender name", () => {
		const messages = [{ senderUserId: "12345678", senderName: "Other" }];
		expect(hasSenderIdCollision(messages, "12345678", "Operator")).toBe(true);
		expect(hasSenderIdCollision(messages, "12345678", "Other")).toBe(false);
		expect(hasSenderIdCollision(messages, "invalid", "Operator")).toBe(false);
	});
});