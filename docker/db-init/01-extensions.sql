-- DB 를 처음 만들 때 한 번 실행됩니다 (db_data 볼륨이 비어 있을 때만).
-- 벡터 검색(AI 임베딩)용 pgvector 확장
CREATE EXTENSION IF NOT EXISTS vector;
