const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma, stubSideEffects } = require("./helpers/mockPrisma");

stubSideEffects();

let candidate;
let updates;

mockPrisma({
  onboardingCandidate: {
    findUnique: async () => candidate,
    update: async ({ data }) => {
      updates.push(data);
      candidate = { ...candidate, ...data };
      return candidate;
    },
  },
  onboardingDocument: { create: async ({ data }) => data },
});

const onboardingService = require("../src/services/onboarding.service");

const fresh = (overrides = {}) => ({
  id: "c1",
  organizationId: "org-1",
  token: "t",
  status: "INVITED",
  expiresAt: new Date(Date.now() + 86400000),
  revokedAt: null,
  documents: [],
  ...overrides,
});

const upload = () =>
  onboardingService.uploadCandidateDocument("t", {
    documentType: "OTHER",
    fileName: "cv.pdf",
    fileUrl: "https://res.cloudinary.com/demo/raw/upload/cv.pdf",
  });

beforeEach(() => {
  candidate = fresh();
  updates = [];
});

describe("candidate status flow", () => {
  it("a document alone does not skip the profile step", async () => {
    await upload();
    assert.equal(updates.length, 0);
    assert.equal(candidate.status, "INVITED");
  });

  it("moves to HR review once the profile is in and a document arrives", async () => {
    candidate = fresh({ status: "PROFILE_SUBMITTED" });
    await upload();
    assert.equal(candidate.status, "UNDER_HR_REVIEW");
  });

  it("submitting the profile after uploading documents also reaches HR review", async () => {
    candidate = fresh({ documents: [{ id: "d1" }] });
    await onboardingService.updateCandidateProfile("t", { currentAddress: "12 Main Rd" });
    assert.equal(candidate.status, "UNDER_HR_REVIEW");
  });

  it("submitting the profile first waits for documents", async () => {
    await onboardingService.updateCandidateProfile("t", { currentAddress: "12 Main Rd" });
    assert.equal(candidate.status, "PROFILE_SUBMITTED");
  });
});

describe("candidate profile validation", () => {
  it("rejects malformed PAN, IFSC, account and Aadhaar numbers before saving", async () => {
    for (const bad of [{ panNumber: "123" }, { ifscCode: "XX" }, { accountNumber: "12ab" }, { aadhaarNumber: "1234" }]) {
      await assert.rejects(onboardingService.updateCandidateProfile("t", bad), (e) => e.statusCode === 400, JSON.stringify(bad));
    }
    assert.equal(updates.length, 0);
  });

  it("normalises valid values and rejects a future birth date", async () => {
    await onboardingService.updateCandidateProfile("t", { panNumber: " abcde1234f ", ifscCode: "hdfc0001234", aadhaarNumber: "1234 5678 9012" });
    assert.equal(updates[0].panNumber, "ABCDE1234F");
    assert.equal(updates[0].ifscCode, "HDFC0001234");
    assert.equal(updates[0].aadhaarNumber, "123456789012");
    await assert.rejects(onboardingService.updateCandidateProfile("t", { dateOfBirth: "2999-01-01" }), /future/);
  });
});
