const express = require('express');
const path = require('path');
const { Redis } = require('@upstash/redis');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== Redis 연결 =====
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const REDIS_KEY = 'scores'; // Hash: { participantId: JSON string of scores }

// ===== 데이터 설정 =====

const GROUPS = ['A', 'B', 'C', 'D'];
const GROUP_MEMBERS = { A: 6, B: 5, C: 6, D: 6 };
const TOPIC_NAMES = {
  1: '외부시장 VS 이익률',
  2: 'AI 활용 아이디어'
};

const participants = [];
GROUPS.forEach(group => {
  for (let i = 1; i <= GROUP_MEMBERS[group]; i++) {
    participants.push({
      id: `${group}${i}`,
      name: `${group}조 ${i}번`,
      group: group
    });
  }
});

// ===== API 엔드포인트 =====

// 참가자 목록 조회
app.get('/api/participants', (req, res) => {
  res.json(participants);
});

// 설정 정보 조회
app.get('/api/config', (req, res) => {
  res.json({
    groups: GROUPS,
    topicNames: TOPIC_NAMES,
    title: '부서장 리더십 교육 분임토의'
  });
});

// 점수 제출
app.post('/api/scores', async (req, res) => {
  try {
    const { participantId, scores: submittedScores } = req.body;

    // 관리자(꽃미남 신상무)는 채점하지 않음
    const isAdmin = participantId === 'admin';
    if (isAdmin) {
      return res.status(400).json({ error: '관리자는 채점할 수 없습니다.' });
    }

    // 참가자 확인
    const participant = participants.find(p => p.id === participantId);
    if (!participant) {
      return res.status(400).json({ error: '유효하지 않은 참가자입니다.' });
    }

    // 본인 조 채점 방지
    for (const key of Object.keys(submittedScores)) {
      const group = key.split('_')[0];
      if (group === participant.group) {
        return res.status(400).json({ error: '본인이 속한 조는 채점할 수 없습니다.' });
      }
    }

    // 점수 유효성 검사
    for (const [key, score] of Object.entries(submittedScores)) {
      if (score < 1 || score > 5 || !Number.isInteger(score)) {
        return res.status(400).json({ error: `점수는 1~5 사이의 정수여야 합니다. (${key}: ${score})` });
      }
    }

    // Redis에 점수 저장
    await redis.hset(REDIS_KEY, { [participantId]: JSON.stringify(submittedScores) });

    res.json({ message: '점수가 제출되었습니다.', participantId });
  } catch (err) {
    console.error('점수 제출 오류:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 특정 참가자의 제출 여부 확인
app.get('/api/scores/:participantId', async (req, res) => {
  try {
    const { participantId } = req.params;
    const data = await redis.hget(REDIS_KEY, participantId);
    const submitted = data ? (typeof data === 'string' ? JSON.parse(data) : data) : null;
    res.json({ participantId, submitted });
  } catch (err) {
    console.error('점수 조회 오류:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 집계 결과 조회
app.get('/api/results', async (req, res) => {
  try {
    const allScores = await redis.hgetall(REDIS_KEY) || {};

    const results = {};
    GROUPS.forEach(group => {
      results[group] = {
        group,
        topic1: { total: 0, count: 0, average: 0 },
        topic2: { total: 0, count: 0, average: 0 },
        totalScore: 0,
        totalAverage: 0
      };
    });

    // 점수 집계
    for (const raw of Object.values(allScores)) {
      const participantScores = typeof raw === 'string' ? JSON.parse(raw) : raw;
      GROUPS.forEach(group => {
        const score1 = participantScores[`${group}_1`];
        const score2 = participantScores[`${group}_2`];

        if (score1 !== undefined) {
          results[group].topic1.total += score1;
          results[group].topic1.count += 1;
        }
        if (score2 !== undefined) {
          results[group].topic2.total += score2;
          results[group].topic2.count += 1;
        }
      });
    }

    // 평균 계산
    GROUPS.forEach(group => {
      const r = results[group];
      r.topic1.average = r.topic1.count > 0 ? +(r.topic1.total / r.topic1.count).toFixed(2) : 0;
      r.topic2.average = r.topic2.count > 0 ? +(r.topic2.total / r.topic2.count).toFixed(2) : 0;
      r.totalScore = r.topic1.total + r.topic2.total;
      r.totalAverage = +(r.topic1.average + r.topic2.average).toFixed(2);
    });

    const ranked = Object.values(results)
      .sort((a, b) => b.totalAverage - a.totalAverage)
      .map((r, i) => ({ ...r, rank: i + 1 }));

    const submittedCount = Object.keys(allScores).length;

    res.json({
      rankings: ranked,
      topicNames: TOPIC_NAMES,
      submission: { total: participants.length, submitted: submittedCount }
    });
  } catch (err) {
    console.error('결과 조회 오류:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 제출 현황 일괄 조회
app.get('/api/submitted', async (req, res) => {
  try {
    const allScores = await redis.hgetall(REDIS_KEY) || {};
    res.json(Object.keys(allScores));
  } catch (err) {
    console.error('제출현황 조회 오류:', err);
    res.json([]);
  }
});

// 데이터 초기화 (관리자용)
app.post('/api/reset', async (req, res) => {
  try {
    await redis.del(REDIS_KEY);
    res.json({ message: '모든 점수가 초기화되었습니다.' });
  } catch (err) {
    console.error('초기화 오류:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 로컬 실행 시에만 listen
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`발표 점수 집계 앱이 http://localhost:${PORT} 에서 실행 중입니다.`);
  });
}

module.exports = app;
