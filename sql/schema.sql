CREATE TABLE IF NOT EXISTS sessions (
  id           CHAR(36)     PRIMARY KEY,
  code         VARCHAR(10)  NOT NULL UNIQUE,
  status       ENUM('idle', 'voting', 'prolonged', 'stopped', 'results')
               NOT NULL DEFAULT 'idle',
  host_secret  CHAR(36)     NOT NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  voting_ends_at DATETIME   NULL DEFAULT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS votes (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  session_id   CHAR(36)     NOT NULL,
  voter_id     VARCHAR(64)  NOT NULL,
  choice       ENUM('pour', 'contre', 'abstention') NOT NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_session_voter (session_id, voter_id),
  CONSTRAINT fk_votes_session
    FOREIGN KEY (session_id) REFERENCES sessions(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE INDEX idx_votes_session ON votes(session_id);

-- Si la table sessions existe déjà (déploiement précédent), ajouter la colonne :
-- ALTER TABLE sessions ADD COLUMN voting_ends_at DATETIME NULL DEFAULT NULL;
