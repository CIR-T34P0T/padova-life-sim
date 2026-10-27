-- M8: university basics. A character's enrolment in a course (enrolments),
-- one row per completed lecture (lecture_attendance) and one per completed
-- exam (assessments). Grades are computed on the server from these rows and
-- the character's academic level; nothing here is ever sent by a client.
-- Rules and numbers: docs/GAME_DESIGN.md "University (M8)"; the course
-- catalogue (timetable, sittings, grading) is data in shared/src/life/config.ts.

-- migrate:up

CREATE TABLE enrolments (
  character_id          uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  -- Ids from shared/src/life/config.ts COURSE_IDS, validated in code.
  course                text NOT NULL CHECK (char_length(course) BETWEEN 1 AND 32),
  status                text NOT NULL CHECK (status IN ('enrolled', 'passed')),
  -- Completed study sessions (any desk or table) while enrolled.
  study_sessions        integer NOT NULL DEFAULT 0 CHECK (study_sessions >= 0),
  enrolled_game_minute  double precision NOT NULL,
  -- Set together when the course is passed (Italian scale: 18–30, 31 = 30 cum laude).
  final_grade           integer CHECK (final_grade BETWEEN 18 AND 31),
  passed_game_minute    double precision,
  enrolled_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, course),
  CHECK ((status = 'passed') = (final_grade IS NOT NULL AND passed_game_minute IS NOT NULL))
);

-- Completed lectures only: a lecture left early is never written. The key is
-- the lecture's game day and start time (e.g. 'd12-0900'), so a lecture counts
-- at most once per character.
CREATE TABLE lecture_attendance (
  character_id          uuid NOT NULL,
  course                text NOT NULL,
  lecture_key           text NOT NULL CHECK (char_length(lecture_key) BETWEEN 1 AND 32),
  game_day              integer NOT NULL CHECK (game_day >= 1),
  attended_game_minute  double precision NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, course, lecture_key),
  FOREIGN KEY (character_id, course) REFERENCES enrolments (character_id, course) ON DELETE CASCADE
);

-- Completed exams only, one per sitting (the key is the sitting's game day,
-- e.g. 'd13'). The inputs the grade was computed from are kept with it.
CREATE TABLE assessments (
  character_id       uuid NOT NULL,
  course             text NOT NULL,
  sitting_key        text NOT NULL CHECK (char_length(sitting_key) BETWEEN 1 AND 32),
  kind               text NOT NULL CHECK (kind IN ('exam')),
  grade              integer NOT NULL CHECK (grade BETWEEN 0 AND 31),
  passed             boolean NOT NULL,
  lectures_attended  integer NOT NULL CHECK (lectures_attended >= 0),
  study_sessions     integer NOT NULL CHECK (study_sessions >= 0),
  academic_level     integer NOT NULL CHECK (academic_level >= 0),
  game_day           integer NOT NULL CHECK (game_day >= 1),
  sat_game_minute    double precision NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, course, sitting_key),
  FOREIGN KEY (character_id, course) REFERENCES enrolments (character_id, course) ON DELETE CASCADE
);

-- migrate:down

-- Refuses, and changes nothing (the migration runs in one transaction), while
-- any character is enrolled: the check below fails if enrolments has a row.
-- Nothing is deleted automatically; remove that data deliberately before
-- rolling back.
ALTER TABLE enrolments ADD CONSTRAINT rollback_refused_while_characters_are_enrolled CHECK (false);
DROP TABLE assessments;
DROP TABLE lecture_attendance;
DROP TABLE enrolments;
