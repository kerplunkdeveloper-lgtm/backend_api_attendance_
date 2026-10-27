const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

process.env.CLOUDINARY_CLOUD_NAME = "democloud";
process.env.CLOUDINARY_API_KEY = "123456";
process.env.CLOUDINARY_API_SECRET = "secret";

const { parseDeliveryUrl, signedDeliveryUrl } = require("../src/config/cloudinary");

const base = "https://res.cloudinary.com/democloud";

describe("opening uploaded documents", () => {
  it("reads how a stored URL was uploaded", () => {
    assert.deepEqual(parseDeliveryUrl(`${base}/image/authenticated/v1700000000/workpulse/employees/e1/documents/aadhaar.jpg`), {
      resourceType: "image",
      deliveryType: "authenticated",
      version: 1700000000,
      publicId: "workpulse/employees/e1/documents/aadhaar",
      format: "jpg",
    });
  });

  it("keeps the extension in the id of raw files", () => {
    const parsed = parseDeliveryUrl(`${base}/raw/authenticated/v5/docs/contract.docx`);
    assert.equal(parsed.publicId, "docs/contract.docx");
    assert.equal(parsed.format, undefined);
  });

  it("is not fooled by a query string, encoded names or other hosts", () => {
    assert.equal(parseDeliveryUrl(`${base}/image/upload/v1/a%20b.png?x=1`).publicId, "a b");
    assert.equal(parseDeliveryUrl("https://example.com/file.pdf"), null);
    assert.equal(parseDeliveryUrl(null), null);
  });

  it("signs private files with their real resource type, never 'auto'", () => {
    const url = signedDeliveryUrl(`${base}/image/authenticated/v1700000000/docs/pan.jpg`);
    assert.match(url, /\/image\/authenticated\//);
    assert.match(url, /s--[\w-]+--/, "carries a signature");
    assert.doesNotMatch(url, /\/auto\//);
    assert.match(url, /pan\.jpg(\?.*)?$/);
  });

  it("signs a private PDF as image, and a raw file as raw", () => {
    assert.match(signedDeliveryUrl(`${base}/image/authenticated/v2/docs/pan.pdf`), /\/image\/authenticated\/.*pan\.pdf(\?.*)?$/);
    assert.match(signedDeliveryUrl(`${base}/raw/authenticated/v2/docs/letter.docx`), /\/raw\/authenticated\/.*letter\.docx(\?.*)?$/);
  });

  it("leaves public files exactly as stored, even for Aadhaar and PAN uploaded before they were private", () => {
    const publicUrl = `${base}/image/upload/v1700000000/docs/old-aadhaar.jpg`;
    assert.equal(signedDeliveryUrl(publicUrl), publicUrl);
  });

  it("passes through empty values and unknown URLs", () => {
    assert.equal(signedDeliveryUrl(""), "");
    assert.equal(signedDeliveryUrl("https://example.com/x.png"), "https://example.com/x.png");
  });
});
