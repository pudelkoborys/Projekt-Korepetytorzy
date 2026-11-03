-- Import this file into the MySQL database selected in phpMyAdmin.
-- It deliberately does not create a database or contain hosting credentials.
SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) NOT NULL,
  role ENUM('student', 'tutor') NOT NULL,
  first_name VARCHAR(80) NOT NULL,
  last_name VARCHAR(80) NOT NULL,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  tutor_id VARCHAR(100) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_tutor_id (tutor_id),
  KEY ix_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tutor_profiles (
  tutor_id VARCHAR(100) NOT NULL,
  user_id CHAR(36) NOT NULL,
  age TINYINT UNSIGNED NULL,
  teaching_since_year SMALLINT UNSIGNED NOT NULL,
  description VARCHAR(2000) NOT NULL,
  price_per_lesson SMALLINT UNSIGNED NOT NULL DEFAULT 100,
  image_path VARCHAR(2048) NOT NULL DEFAULT '',
  PRIMARY KEY (tutor_id),
  UNIQUE KEY uq_tutor_profiles_user (user_id),
  CONSTRAINT fk_tutor_profiles_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tutor_subjects (
  tutor_id VARCHAR(100) NOT NULL,
  subject VARCHAR(80) NOT NULL,
  PRIMARY KEY (tutor_id, subject),
  CONSTRAINT fk_tutor_subjects_tutor FOREIGN KEY (tutor_id)
    REFERENCES tutor_profiles (tutor_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subject_tags (
  name VARCHAR(80) NOT NULL,
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO subject_tags (name) VALUES
  ('Matematyka'), ('Fizyka'), ('Chemia'), ('Informatyka'), ('Angielski'),
  ('Biologia'), ('Polski'), ('Historia'), ('Geografia'), ('WOS'),
  ('Filozofia'), ('Ekonomia'), ('Język Niemiecki'), ('Język Francuski'),
  ('Język Hiszpański'), ('Język Włoski'), ('Język Rosyjski'),
  ('Język Polski Dla Obcokrajowców'), ('Przyroda'), ('Edukacja Wczesnoszkolna'),
  ('Wiedza O Społeczeństwie'), ('Programowanie'), ('Algorytmika'), ('Statystyka'),
  ('Rachunek Różniczkowy'), ('Elektrotechnika'), ('Mechanika'), ('Astronomia'),
  ('Muzyka'), ('Plastyka'), ('Religia'), ('Etyka'), ('Łacina');

CREATE TABLE IF NOT EXISTS tutor_levels (
  tutor_id VARCHAR(100) NOT NULL,
  level ENUM('primary', 'secondary', 'tertiary') NOT NULL,
  PRIMARY KEY (tutor_id, level),
  CONSTRAINT fk_tutor_levels_tutor FOREIGN KEY (tutor_id)
    REFERENCES tutor_profiles (tutor_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tutor_availability (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tutor_id VARCHAR(100) NOT NULL,
  weekday TINYINT UNSIGNED NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  PRIMARY KEY (id),
  KEY ix_availability_tutor_weekday (tutor_id, weekday),
  CONSTRAINT fk_availability_tutor FOREIGN KEY (tutor_id)
    REFERENCES tutor_profiles (tutor_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tutor_days_off (
  tutor_id VARCHAR(100) NOT NULL,
  day_off DATE NOT NULL,
  PRIMARY KEY (tutor_id, day_off),
  CONSTRAINT fk_days_off_tutor FOREIGN KEY (tutor_id)
    REFERENCES tutor_profiles (tutor_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bookings (
  id CHAR(36) NOT NULL,
  tutor_id VARCHAR(100) NOT NULL,
  student_id CHAR(36) NOT NULL,
  lesson_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  duration_minutes TINYINT UNSIGNED NOT NULL DEFAULT 40,
  subject VARCHAR(80) NOT NULL,
  education_level ENUM('primary', 'secondary', 'tertiary') NOT NULL,
  zoom_status ENUM('pending', 'ready', 'failed') NOT NULL DEFAULT 'pending',
  zoom_meeting_id VARCHAR(64) NOT NULL DEFAULT '',
  zoom_join_url VARCHAR(2048) NOT NULL DEFAULT '',
  zoom_start_url VARCHAR(2048) NOT NULL DEFAULT '',
  zoom_error VARCHAR(500) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_bookings_tutor_date (tutor_id, lesson_date, start_time),
  KEY ix_bookings_student_date (student_id, lesson_date, start_time),
  CONSTRAINT fk_bookings_tutor FOREIGN KEY (tutor_id)
    REFERENCES tutor_profiles (tutor_id) ON DELETE CASCADE,
  CONSTRAINT fk_bookings_student FOREIGN KEY (student_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reviews (
  id CHAR(36) NOT NULL,
  student_id CHAR(36) NOT NULL,
  tutor_id VARCHAR(100) NOT NULL,
  booking_id CHAR(36) NOT NULL,
  rating TINYINT UNSIGNED NOT NULL,
  review_date DATE NOT NULL,
  comment VARCHAR(2000) NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reviews_student_tutor (student_id, tutor_id),
  UNIQUE KEY uq_reviews_booking (booking_id),
  KEY ix_reviews_tutor_date (tutor_id, review_date),
  CONSTRAINT fk_reviews_student FOREIGN KEY (student_id)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_tutor FOREIGN KEY (tutor_id)
    REFERENCES tutor_profiles (tutor_id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_booking FOREIGN KEY (booking_id)
    REFERENCES bookings (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) NOT NULL,
  user_id CHAR(36) NOT NULL,
  expires_at DATETIME NOT NULL,
  PRIMARY KEY (token_hash),
  KEY ix_sessions_user_expiry (user_id, expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash CHAR(64) NOT NULL,
  user_id CHAR(36) NULL,
  purpose ENUM('connect', 'login', 'register') NOT NULL,
  role ENUM('student', 'tutor') NOT NULL,
  return_to VARCHAR(2048) NOT NULL DEFAULT '/',
  expires_at DATETIME NOT NULL,
  PRIMARY KEY (state_hash),
  KEY ix_oauth_states_expiry (expires_at),
  CONSTRAINT fk_oauth_states_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS zoom_connections (
  user_id CHAR(36) NOT NULL,
  encrypted_tokens MEDIUMTEXT NOT NULL,
  iv VARBINARY(16) NOT NULL,
  auth_tag VARBINARY(16) NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_zoom_connections_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS login_attempts (
  ip_hash CHAR(64) NOT NULL,
  attempted_at DATETIME NOT NULL,
  KEY ix_login_attempts_ip_time (ip_hash, attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
