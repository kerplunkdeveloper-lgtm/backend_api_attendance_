const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma, stubSideEffects } = require("./helpers/mockPrisma");

stubSideEffects();

let capturedDoc = null;
const prisma = {
  onboardingCandidate: {
    findUnique: async ({ where }) => {
      if (where.token === "tok-1") {
        return {
          id: "cand-1",
          organizationId: "org-a",
          token: "tok-1",
          status: "INVITED",
          expiresAt: new Date(Date.now() + 86400000),
          revokedAt: null,
          documents: [],
        };
      }
      return null;
    },
    update: async () => ({}),
  },
  onboardingDocument: {
    create: async ({ data }) => {
      capturedDoc = data;
      return data;
    },
  },
};

mockPrisma(prisma);

const onboardingService = require("../src/services/onboarding.service");

describe("candidate portal upload", () => {
  it("rejects an empty body without a file", async () => {
    await assert.rejects(
      () => onboardingService.uploadCandidateDocument("tok-1", {}),
      /documentType and a file/,
    );
  });

  it("rejects expired invitations", async () => {
    prisma.onboardingCandidate.findUnique = async () => ({
      id: "cand-1",
      token: "tok-expired",
      status: "INVITED",
      expiresAt: new Date("2020-01-01"),
      revokedAt: null,
      documents: [],
    });
    await assert.rejects(
      () => onboardingService.getCandidateByToken("tok-expired"),
      /expired/,
    );
  });

  it("rejects invitations older than 14 days even without expiresAt", async () => {
    prisma.onboardingCandidate.findUnique = async () => ({
      id: "cand-old",
      token: "tok-old",
      status: "INVITED",
      expiresAt: null,
      createdAt: new Date("2020-01-01"),
      revokedAt: null,
      documents: [],
    });
    await assert.rejects(
      () => onboardingService.getCandidateByToken("tok-old"),
      /expired/,
    );
  });
});
