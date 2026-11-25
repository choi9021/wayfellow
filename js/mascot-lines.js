// mascot-lines.js - 디딤이(돌멩이) 대사 모음
//
// "디딤돌 마스코트 등장 스크립트"(치료자 작성)를 그대로 코드로 옮긴 데이터 파일이다.
// 트리거 이름을 키로 모아뒀고, 각 모듈은 이 파일을 직접 건드리지 않고
// mascot.js의 Mascot.say(트리거) 하나만 부른다.
//
// face 값은 PDF의 표정 코드(default/rest/quiet/curious/sleep) 그대로 남겨뒀고,
// mascot.js가 각 코드를 실제 그림 파일로 매핑해서 그린다(FACE_IMAGES). 지금은 default/
// rest/quiet 셋 다 같은 "기본/편안한" 그림(assets/mascot-default.png)을 가리키고,
// curious만 "눈웃음" 그림(assets/mascot-eyesmile.png)을 가리키는데, 이건 사용자가 준
// 그림 자산이 기본/눈웃음/기쁨/수면 4종뿐이라서(표정별로 전부 다른 그림이 없음) 기존
// face 코드를 그대로 쓰면서 그림만 묶어서 재사용한 것 — "새 표정 그림이 생기면 코드만
// 고치면 된다"던 예전 메모가 실제로 실현된 사례다.
// anim 값(wiggle/jump)은 mascot.js가 해당 트리거가 뜰 때 한 번 재생하는 애니메이션이다.
// 없으면 평소의 "숨쉬기"(ambient 상태일 때만) 외에 추가 동작 없음.
//
// 아래 두 트리거는 PDF의 "열린 질문"에 따라 바꿨다 (현재 앱에 없는 기능이라서):
// - exposure.before: 원래 "예측 적기"를 전제로 한 대사였는데, 그 기능이 없어서
//   PDF가 제안한 대체 대사("준비되면 시작해. 나는 여기서 기다릴게.")로 바꿨다.
// - exposure.compare, session.today, therapist.message: 비교 화면/회기 날짜/치료자 메시지
//   기능 자체가 없어서 아예 데이터에서 뺐다. 기능이 생기면 이 파일에 추가하면 된다.
//
// home.missionPending은 PDF에 없는, 화면별 마스코트 상태 요청(2026-11-25)에 맞춰 추가한
// 트리거다. 대사 텍스트는 짓지 않고(text: '') 표정+애니메이션만 하루 한 번 보여준다 -
// PDF가 유일한 대사 출처라는 원칙은 "말풍선 문구"에 한정되고, 이건 말풍선이 없다.
(function () {
  window.MASCOT_LINES = {
    // 시작과 첫 실행 (safety.js)
    'splash': { face: 'default', text: '' }, // 대사 없음 - 돌 위에 앉아있기만 한다
    'firstRun.after': {
      face: 'default',
      text: '안녕, 나는 디딤이야. 선생님이랑 건너는 길에 나도 옆에 있을게.',
    },
    'patientCode.done': { face: 'rest', text: '준비됐어. 천천히 둘러봐.' },

    // 위계표 (hierarchy.js)
    'hierarchy.empty': {
      face: 'default',
      text: '아직 놓인 돌이 없어. 다음 회기에 선생님이랑 첫 돌을 놓아보자.',
    },
    'hierarchy.firstAdded': { face: 'rest', text: '첫 돌이 놓였어. 여기서부터 시작이야.' },
    'hierarchy.weeklySet': { face: 'default', text: '이번 주에 건너볼 돌이야.' },
    'hierarchy.settled': { face: 'curious', text: '이 돌, 처음 놓았을 때랑 느낌이 달라졌네.' },

    // 실제노출 (exposure.js)
    'exposure.before': { face: 'quiet', text: '준비되면 시작해. 나는 여기서 기다릴게.' },
    'exposure.start': {
      face: 'default',
      text: '다녀와. 여기서 기다릴게.',
      autoHideMs: 2000,
    },
    // 노출 기록 완료(끝까지 머문 경우): 눈웃음 + 짧은 점프로 반김(화면별 마스코트 상태 요청)
    'exposure.done': { face: 'eyeSmile', anim: 'jump', text: '끝까지 머물렀어. 그게 오늘의 걸음이야.' },
    'exposure.stoppedEarly': {
      face: 'quiet',
      text: '여기까지 온 것도 걸음이야. 어디서 멈췄는지 선생님이랑 같이 보자.',
    },

    // 상상노출 (listening.js)
    'listening.before': { face: 'quiet', text: '편한 자리에 앉아. 준비되면 시작하자.' },
    'listening.reflect': { face: 'curious', text: '지금 여기는, 실제로 위험한 곳일까?' },
    'listening.saved': { face: 'rest', text: '적어줘서 고마워. 이 문장은 주머니에 넣어둘게.' },

    // 호흡 (breathing.js)
    'breathing.before': { face: 'rest', text: '같이 숨 쉬어볼까?' },
    'breathing.done': { face: 'rest', text: '조금 느슨해졌으면 좋겠다.' },

    // 홈 (home.js) - 오늘의 과제가 남아있을 때 하루 한 번만 눈웃음+좌우 흔들기로 알림
    'home.missionPending': { face: 'eyeSmile', anim: 'wiggle', text: '', autoHideMs: 1600 },

    // 기록 (records.js)
    'records.empty': { face: 'default', text: '아직 기록이 없어. 첫 걸음을 기다리고 있을게.' },
    'records.enter': { face: 'default', text: '지금까지 건너온 길이야.' },
    'records.weekFull': { face: 'rest', text: '이번 주 걸음, 다 채웠어.' },
    'records.weekPartial': {
      face: 'default',
      text: '이번 주에 디딘 걸음이야. 남은 건 회기 때 같이 얘기해보자.',
    },

    // 안전장치 (safety.js)
    'help.open': { face: 'quiet', text: '여기 있어. 같이 천천히 해보자.' },
    'help.after': {
      face: 'quiet',
      text: '조금 괜찮아졌다면 오늘은 쉬어도 돼. 아니라면 아래 연락처를 눌러줘.',
    },

    // 상황별 대사
    'return.afterLong': {
      face: 'default',
      text: '어, 왔구나. 기다리고 있었어. 오늘은 둘러보기만 해도 돼.',
    },
    'time.lateNight': {
      face: 'quiet',
      text: '늦은 시간이네. 몸이 힘들면 추스르고 내일 해도 괜찮아.',
    },
  };

  // 차례로 보여줄 기본 인사 (greeting.default, 하루에 하나씩 돌아가며)
  window.MASCOT_GREETINGS = [
    '오늘도 와줘서 고마워.',
    '천천히 해도 괜찮아.',
    '새벽 공기가 조용하네.',
    '한 발자국이면 충분해.',
    '오늘은 어느 돌 앞에 서볼까?',
  ];
})();
