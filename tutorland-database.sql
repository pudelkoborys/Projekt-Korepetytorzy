-- Complete schema for a new, empty Tutorland database.
-- Select the newly created database in phpMyAdmin before importing this file.
-- This file does not create/drop the database or contain hosting credentials.
SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE users (
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

CREATE TABLE user_profile_photos (
  user_id CHAR(36) NOT NULL,
  image_data MEDIUMTEXT NOT NULL,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_profile_photos_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tutor_profiles (
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

CREATE TABLE tutor_subjects (
  tutor_id VARCHAR(100) NOT NULL,
  subject VARCHAR(80) NOT NULL,
  PRIMARY KEY (tutor_id, subject),
  CONSTRAINT fk_tutor_subjects_tutor FOREIGN KEY (tutor_id)
    REFERENCES tutor_profiles (tutor_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE subject_tags (
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

CREATE TABLE tutor_levels (
  tutor_id VARCHAR(100) NOT NULL,
  level ENUM('primary', 'secondary', 'tertiary') NOT NULL,
  PRIMARY KEY (tutor_id, level),
  CONSTRAINT fk_tutor_levels_tutor FOREIGN KEY (tutor_id)
    REFERENCES tutor_profiles (tutor_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tutor_availability (
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

CREATE TABLE tutor_days_off (
  tutor_id VARCHAR(100) NOT NULL,
  day_off DATE NOT NULL,
  PRIMARY KEY (tutor_id, day_off),
  CONSTRAINT fk_days_off_tutor FOREIGN KEY (tutor_id)
    REFERENCES tutor_profiles (tutor_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tutor_day_availability (
  tutor_id VARCHAR(100) NOT NULL,
  lesson_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  PRIMARY KEY (tutor_id, lesson_date),
  CONSTRAINT fk_day_availability_tutor FOREIGN KEY (tutor_id)
    REFERENCES tutor_profiles (tutor_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE bookings (
  id CHAR(36) NOT NULL,
  tutor_id VARCHAR(100) NOT NULL,
  student_id CHAR(36) NOT NULL,
  lesson_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  duration_minutes TINYINT UNSIGNED NOT NULL DEFAULT 40,
  subject VARCHAR(80) NOT NULL,
  education_level ENUM('primary', 'secondary', 'tertiary') NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_bookings_tutor_date (tutor_id, lesson_date, start_time),
  KEY ix_bookings_student_date (student_id, lesson_date, start_time),
  CONSTRAINT fk_bookings_tutor FOREIGN KEY (tutor_id)
    REFERENCES tutor_profiles (tutor_id) ON DELETE CASCADE,
  CONSTRAINT fk_bookings_student FOREIGN KEY (student_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE chat_conversations (
  id CHAR(36) NOT NULL,
  student_id CHAR(36) NOT NULL,
  tutor_id VARCHAR(100) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_chat_student_tutor (student_id, tutor_id),
  KEY ix_chat_tutor_activity (tutor_id, created_at),
  CONSTRAINT fk_chat_student FOREIGN KEY (student_id)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_tutor FOREIGN KEY (tutor_id)
    REFERENCES tutor_profiles (tutor_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE chat_messages (
  id CHAR(36) NOT NULL,
  conversation_id CHAR(36) NOT NULL,
  sender_id CHAR(36) NOT NULL,
  message_type ENUM('user', 'booking_notice') NOT NULL DEFAULT 'user',
  content VARCHAR(4000) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_chat_messages_history (conversation_id, created_at, id),
  CONSTRAINT fk_chat_message_conversation FOREIGN KEY (conversation_id)
    REFERENCES chat_conversations (id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_message_sender FOREIGN KEY (sender_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sessions (
  token_hash CHAR(64) NOT NULL,
  user_id CHAR(36) NOT NULL,
  expires_at DATETIME NOT NULL,
  PRIMARY KEY (token_hash),
  KEY ix_sessions_user_expiry (user_id, expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE login_attempts (
  ip_hash CHAR(64) NOT NULL,
  attempted_at DATETIME NOT NULL,
  KEY ix_login_attempts_ip_time (ip_hash, attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
