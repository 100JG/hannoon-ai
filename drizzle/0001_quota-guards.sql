-- Custom SQL migration file, put your code below! --
CREATE TRIGGER jobs_usage_guard BEFORE INSERT ON jobs
BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM jobs WHERE state NOT IN ('completed','failed') AND expires_at>NEW.created_at)>=8
    OR (SELECT COUNT(*) FROM jobs WHERE owner=NEW.owner AND state NOT IN ('completed','failed') AND expires_at>NEW.created_at)>=2
    THEN RAISE(ABORT,'queue_limit') END;
  INSERT INTO quotas(day,scope,used) VALUES (NEW.quota_day,'global',0) ON CONFLICT DO NOTHING;
  INSERT INTO quotas(day,scope,used) VALUES (NEW.quota_day,'api',0) ON CONFLICT DO NOTHING;
  INSERT INTO quotas(day,scope,used) VALUES (NEW.quota_day,'session:'||NEW.owner,0) ON CONFLICT DO NOTHING;
  INSERT INTO quotas(day,scope,used) VALUES (NEW.quota_day,'ip:'||NEW.ip_hash,0) ON CONFLICT DO NOTHING;
  SELECT CASE WHEN
    (SELECT used FROM quotas WHERE day=NEW.quota_day AND scope='global')>=NEW.global_limit OR
    (SELECT used FROM quotas WHERE day=NEW.quota_day AND scope='api')+NEW.reserved_calls>NEW.api_limit OR
    (SELECT used FROM quotas WHERE day=NEW.quota_day AND scope='session:'||NEW.owner)>=NEW.session_limit OR
    (SELECT used FROM quotas WHERE day=NEW.quota_day AND scope='ip:'||NEW.ip_hash)>=NEW.ip_limit
    THEN RAISE(ABORT,'usage_limit') END;
  UPDATE quotas SET used=used+1 WHERE day=NEW.quota_day AND scope IN ('global','session:'||NEW.owner,'ip:'||NEW.ip_hash);
  UPDATE quotas SET used=used+NEW.reserved_calls WHERE day=NEW.quota_day AND scope='api';
END;
