-- migration: crear tabla user_fcm_tokens
-- fecha: 2026-07-20

CREATE TABLE IF NOT EXISTS user_fcm_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(500) NOT NULL UNIQUE,
  device_type VARCHAR(50) DEFAULT 'web',
  last_used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indices para optimizar las consultas por usuario
CREATE INDEX IF NOT EXISTS idx_user_fcm_tokens_usuario ON user_fcm_tokens(usuario_id);
