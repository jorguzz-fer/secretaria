-- Migration 0016: pausa da IA por conversa (Escalada / hand-off)
-- Non-breaking: novas colunas com default

ALTER TABLE "WhatsAppConversation"
  ADD COLUMN IF NOT EXISTS "aiPaused"       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "aiPausedReason" TEXT,
  ADD COLUMN IF NOT EXISTS "aiPausedAt"     TIMESTAMP(3);
