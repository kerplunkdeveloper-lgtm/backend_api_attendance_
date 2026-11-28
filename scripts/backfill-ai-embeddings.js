#!/usr/bin/env node
require("dotenv").config();

const prisma = require("../src/config/database");
const OpenAI = require("openai");

const execute = process.argv.includes("--execute");
const limit = Math.min(Math.max(Number(process.env.EMBEDDING_BACKFILL_LIMIT || 1000), 1), 5000);
const model = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for embedding backfill.");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const documents = await prisma.aIKnowledgeDocument.findMany({
    where: { embedding: null, archivedAt: null, isPublished: true },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, title: true, content: true },
  });
  console.log(JSON.stringify({ mode: execute ? "execute" : "dry-run", model, candidates: documents.length, limit }));
  if (!execute || documents.length === 0) return;

  for (let index = 0; index < documents.length; index += 1) {
    const document = documents[index];
    const input = `${document.title}\n\n${document.content}`.slice(0, 120000);
    const response = await client.embeddings.create({ model, input });
    const embedding = response.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) throw new Error(`No embedding returned for ${document.id}`);
    await prisma.aIKnowledgeDocument.update({ where: { id: document.id }, data: { embedding, embeddingModel: model } });
    console.log(JSON.stringify({ processed: index + 1, total: documents.length, id: document.id }));
  }
}

main().catch((error) => { console.error(`[embedding-backfill] ${error.message}`); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
