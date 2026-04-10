const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== 데이터 초기화 =====

const GROUPS = ['A', 'B', 'C', 'D', 'E'];
const MEMBERS_PER_GROUP = 5;
const TOPIC_NAMES = {
  1: '외부시장 VS 이익률',
  2: 'AI 활용 아이디어'
};

// 참가자 목록 생성 (A조 1~5번, B조 1~5번, ...)
const participants = [];
GROUPS.forEach(group => {
  for (let i = 1; i <= MEMBERS_PER_GROUP; i++) {
    participants.push({
      id: `${group}${i}`,
      name: `${group}조 ${i}번`,
      group: group
    });
  }
});

// 점수 저장소: { participantId: { "A_1": score, "A_2": score, ... } }
const scores = {};

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
app.post('/api/scores', (req, res) => {
  const { participantId, scores: submittedScores } = req.body;

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

  // 점수 저장
  scores[participantId] = submittedScores;

  res.json({ message: '점수가 제출되었습니다.', participantId });
});

// 특정 참가자의 제출 여부 확인
app.get('/api/scores/:participantId', (req, res) => {
  const { participantId } = req.params;
  const submitted = scores[participantId] || null;
  res.json({ participantId, submitted });
});

// 집계 결과 조회
app.get('/api/results', (req, res) => {
  const results = {};

  // 각 조별 초기화
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
  Object.values(scores).forEach(participantScores => {
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
  });

  // 평균 계산 및 합산
  GROUPS.forEach(group => {
    const r = results[group];
    r.topic1.average = r.topic1.count > 0 ? +(r.topic1.total / r.topic1.count).toFixed(2) : 0;
    r.topic2.average = r.topic2.count > 0 ? +(r.topic2.total / r.topic2.count).toFixed(2) : 0;
    r.totalScore = r.topic1.total + r.topic2.total;
    r.totalAverage = +(r.topic1.average + r.topic2.average).toFixed(2);
  });

  // 순위 정렬 (총 평균 기준 내림차순)
  const ranked = Object.values(results)
    .sort((a, b) => b.totalAverage - a.totalAverage)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  // 제출 현황
  const totalParticipants = participants.length;
  const submittedCount = Object.keys(scores).length;

  res.json({
    rankings: ranked,
    topicNames: TOPIC_NAMES,
    submission: { total: totalParticipants, submitted: submittedCount }
  });
});

// 제출 현황 일괄 조회
app.get('/api/submitted', (req, res) => {
  res.json(Object.keys(scores));
});

// 데이터 초기화 (관리자용)
app.post('/api/reset', (req, res) => {
  Object.keys(scores).forEach(key => delete scores[key]);
  res.json({ message: '모든 점수가 초기화되었습니다.' });
});

app.listen(PORT, () => {
  console.log(`발표 점수 집계 앱이 http://localhost:${PORT} 에서 실행 중입니다.`);
});
