const DEFAULT_OFFER_LETTER_TEMPLATE = {
  title: "EMPLOYMENT OFFER LETTER",
  greeting: "Dear {{candidateName}},",
  introduction: "We are pleased to offer you employment with {{companyName}}. We believe your skills and experience will be a valuable addition to our team.",
  terms: [
    "Probation period: 3 months.",
    "Notice period: 30 days after confirmation.",
    "Working hours: As per company policy.",
    "This offer is subject to verification of the information and documents provided during onboarding.",
    "Compensation, benefits and leave are governed by the company's current policies and applicable law.",
    "You must protect confidential company, customer and employee information and use personal data only for authorized business purposes.",
    "All work product and intellectual property created during employment for company business belongs to the company, subject to applicable law.",
    "This offer may be withdrawn or employment may be terminated in accordance with company policy, the employment agreement and applicable law.",
  ],
  signatoryName: "",
  signatoryTitle: "Authorized signatory",
  primaryColor: "#163b8f",
  footer: "This is a digitally generated offer letter. Please retain a copy for your records.",
};

const clean = (value, fallback, max = 1000) => {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : fallback;
};

const normalizeOfferLetterTemplate = (value = {}) => ({
  title: clean(value.title, DEFAULT_OFFER_LETTER_TEMPLATE.title, 120),
  greeting: clean(value.greeting, DEFAULT_OFFER_LETTER_TEMPLATE.greeting, 300),
  introduction: clean(value.introduction, DEFAULT_OFFER_LETTER_TEMPLATE.introduction, 1200),
  terms: (() => {
    const terms = Array.isArray(value.terms) ? value.terms.map((term) => String(term || "").trim()).filter(Boolean).slice(0, 8).map((term) => term.slice(0, 400)) : [];
    const originalDefault = DEFAULT_OFFER_LETTER_TEMPLATE.terms.slice(0, 4);
    return terms.length === originalDefault.length && terms.every((term, index) => term === originalDefault[index]) ? DEFAULT_OFFER_LETTER_TEMPLATE.terms : (terms.length ? terms : DEFAULT_OFFER_LETTER_TEMPLATE.terms);
  })(),
  signatoryName: clean(value.signatoryName, "", 120),
  signatoryTitle: clean(value.signatoryTitle, DEFAULT_OFFER_LETTER_TEMPLATE.signatoryTitle, 120),
  primaryColor: /^#[0-9a-f]{6}$/i.test(String(value.primaryColor || "")) ? value.primaryColor : DEFAULT_OFFER_LETTER_TEMPLATE.primaryColor,
  footer: clean(value.footer, DEFAULT_OFFER_LETTER_TEMPLATE.footer, 400),
  sourceType: ["EDITOR", "JSON", "CSV", "TXT", "MD", "HTML", "DOCX"].includes(String(value.sourceType || "").toUpperCase()) ? String(value.sourceType).toUpperCase() : "EDITOR",
  sourceFileName: clean(value.sourceFileName, "", 180),
  version: Number.isInteger(Number(value.version)) && Number(value.version) > 0 ? Number(value.version) : 1,
  status: ["DRAFT", "ACTIVE", "ARCHIVED"].includes(String(value.status || "").toUpperCase()) ? String(value.status).toUpperCase() : "ACTIVE",
  pdf: value.pdf && typeof value.pdf === "object" ? {
    provider: ["s3", "cloudinary"].includes(String(value.pdf.provider || "").toLowerCase()) ? String(value.pdf.provider).toLowerCase() : null,
    key: String(value.pdf.key || "").trim().slice(0, 500) || null,
    url: /^https:\/\/[^\s"'<>]+$/i.test(String(value.pdf.url || "")) ? String(value.pdf.url) : null,
    fileName: clean(value.pdf.fileName, "offer-letter-template.pdf", 180),
    bytes: Math.max(0, Number(value.pdf.bytes) || 0),
  } : null,
  pdfFields: value.pdfFields && typeof value.pdfFields === "object" && !Array.isArray(value.pdfFields)
    ? Object.fromEntries(Object.entries(value.pdfFields).slice(0, 30).map(([key, field]) => [String(key).slice(0, 80), {
      page: Math.max(1, Math.round(Number(field?.page) || 1)),
      x: Math.max(0, Number(field?.x) || 0),
      y: Math.max(0, Number(field?.y) || 0),
      fontSize: Math.min(48, Math.max(6, Number(field?.fontSize) || 10)),
      color: /^#[0-9a-f]{6}$/i.test(String(field?.color || "")) ? String(field.color) : "#111827",
      maxWidth: Math.max(0, Number(field?.maxWidth) || 0),
    }])) : {},
});

module.exports = { DEFAULT_OFFER_LETTER_TEMPLATE, normalizeOfferLetterTemplate };
