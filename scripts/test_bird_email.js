const { BirdClient } = require("@messagebird/sdk");

async function main() {
  const bird = new BirdClient({ apiKey: "bk_us1_7pGGiOf037uUbNi9otmzr984f81le" });

  try {
    console.log("Dispatching test email to kerplunkdeveloper@gmail.com via Bird API...");
    const msg = await bird.email.send({
      from: { email: "onboarding@messagebird.dev", name: "Bird" },
      to: ["kerplunkdeveloper@gmail.com"],
      subject: "Hello World - WorkPulse Test",
      html: "<p>You made your <strong>first email fly</strong>. Congratulations from WorkPulse!</p>",
    });

    console.log("Success! Message ID:", msg.id, "Status:", msg.status);
  } catch (err) {
    console.error("Bird Send Error:", err.message || err);
  }
}

main();
