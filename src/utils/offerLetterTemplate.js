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
});

module.exports = { DEFAULT_OFFER_LETTER_TEMPLATE, normalizeOfferLetterTemplate };
