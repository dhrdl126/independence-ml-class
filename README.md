# 독립운동가 AI 분류 수업 웹앱

Firebase + GitHub Pages 기반의 한국사 AI 융합 수업용 정적 웹앱입니다. 농업계 고등학교 1학년 1반, 3반, 5반, 7반, 9반 학생이 Google 학교 계정으로 접속해 키워드 라벨링, 인물카드 작성, 머신러닝 분류 체험, 성찰일지를 수행합니다.

## 구성

| 파일 | 역할 |
| --- | --- |
| `index.html` | Google 로그인, 학교 계정 검증, 이름 등록, 대기 화면 |
| `session1.html` | 1차시: 키워드 라벨링, 인물카드 |
| `session2.html` | 2차시: ML 개념, 텍스트 분류, 성찰일지 |
| `teacher.html` | 교사용 진행 제어, 실시간 현황판, CSV 내보내기 |
| `js/firebase-config.js` | Firebase 설정. 배포 시 GitHub Secrets로 자동 생성 |
| `js/keywords.js` | 48개 키워드와 교사용 정답 참고표 |
| `js/utils.js` | localStorage, 재전송 큐, 날짜 포맷 공통 유틸 |
| `firestore.rules` | Firestore 보안 규칙 |
| `.github/workflows/deploy.yml` | GitHub Pages 자동 배포 |

## 1. Firebase 프로젝트 생성

1. [Firebase Console](https://console.firebase.google.com/)에 접속합니다.
2. `프로젝트 추가`를 선택하고 프로젝트를 생성합니다.
3. 왼쪽 메뉴에서 `빌드 > Firestore Database`를 엽니다.
4. `데이터베이스 만들기`를 누르고 프로덕션 모드로 시작합니다.
5. 지역은 학교/운영 환경에 맞게 선택합니다.
6. 로컬에서 Firebase CLI를 사용할 경우 로그인 후 규칙을 배포합니다.

```bash
firebase login
firebase use <프로젝트_ID>
firebase deploy --only firestore:rules
```

## 2. Google OAuth 설정

1. Firebase Console에서 `빌드 > Authentication`을 엽니다.
2. `Sign-in method` 탭에서 `Google` 제공업체를 사용 설정합니다.
3. 지원 이메일을 선택하고 저장합니다.
4. `Authentication > Settings > 승인된 도메인`에 GitHub Pages 도메인을 추가합니다.
   예: `<github-id>.github.io`
5. 학생 계정은 다음 형식만 수업 대상으로 처리됩니다.

```text
26jj18h{학번}@g.jbedu.kr
예: 26jj18h1301@g.jbedu.kr = 1학년 3반 01번
```

## 3. GitHub Secrets 등록

GitHub 저장소에서 `Settings > Secrets and variables > Actions > New repository secret`로 아래 값을 등록합니다.

| Secret 이름 | Firebase 웹 앱 설정 항목 |
| --- | --- |
| `FIREBASE_API_KEY` | `apiKey` |
| `FIREBASE_AUTH_DOMAIN` | `authDomain` |
| `FIREBASE_PROJECT_ID` | `projectId` |
| `FIREBASE_STORAGE_BUCKET` | `storageBucket` |
| `FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `FIREBASE_APP_ID` | `appId` |

Firebase 웹 앱 설정값은 Firebase Console의 `프로젝트 설정 > 일반 > 내 앱 > SDK 설정 및 구성`에서 확인합니다.

GitHub Pages 배포 설정:

1. GitHub 저장소의 `Settings > Pages`로 이동합니다.
2. `Build and deployment`의 Source를 `GitHub Actions`로 선택합니다.
3. `main` 브랜치에 push하면 `.github/workflows/deploy.yml`이 실행됩니다.
4. 워크플로우가 `js/firebase-config.js`를 Secrets 값으로 생성한 뒤 정적 파일 전체를 GitHub Pages에 배포합니다.

## 4. 교사 계정 등록

교사 계정은 Firestore 콘솔에서 수동으로 등록합니다.

1. 교사가 먼저 한 번 Google 로그인을 시도해 Firebase Authentication에 사용자 UID가 생기게 합니다.
2. Firebase Console에서 `Authentication > Users`로 이동합니다.
3. 교사 계정의 UID를 복사합니다.
4. Firestore Database에서 `teachers` 컬렉션을 만듭니다.
5. 문서 ID를 교사 UID로 지정해 문서를 생성합니다.
6. 문서 내용은 최소한 아래처럼 둡니다.

```json
{
  "role": "teacher",
  "name": "교사 이름"
}
```

`teachers/{uid}` 문서가 있는 계정만 `teacher.html`에 접근할 수 있습니다.

## 5. Firestore 데이터 구조

```text
teachers/{uid}
students/{uid}

classes/{반번호}/
  settings/control
    { phase, timer, timerStartedAt, timerEndsAt }
  students/{uid}
    { name, grade, classNum, number, email, loginAt }
  labelings/{uid}
    { results: [{ keyword, label }], completedAt }
  cards/{uid}
    { character, label, goal, context, action, result, submittedAt }
  reflections/{uid}
    { situationCard, journal, submittedAt }
```

## 6. 첫 수업 전 체크리스트

- Firebase 웹 앱을 만들고 GitHub Secrets 6개를 모두 등록했습니다.
- Firebase Authentication에서 Google 로그인을 켰습니다.
- GitHub Pages Source를 `GitHub Actions`로 설정했습니다.
- Firebase 승인된 도메인에 GitHub Pages 도메인을 추가했습니다.
- `firestore.rules`를 Firebase에 배포했습니다.
- 교사 UID로 `teachers/{uid}` 문서를 만들었습니다.
- `js/keywords.js`의 48개 키워드와 `KEYWORD_ANSWERS`를 수업 의도에 맞게 검토했습니다.
- 교사용 대시보드에서 반 탭, phase 버튼, 타이머가 동작하는지 확인했습니다.
- 학생 테스트 계정으로 로그인해 대기 화면에서 교사 phase 변경에 따라 자동 이동되는지 확인했습니다.
- 수업 중 네트워크가 불안정할 경우 임시저장과 자동 재전송 안내가 표시되는지 확인했습니다.

## 진행 단계 값

| phase | 학생 화면 |
| --- | --- |
| `waiting` | 대기 화면 |
| `session1_label` | 1차시 키워드 라벨링 |
| `session1_card` | 1차시 인물카드 |
| `session2_concept` | 2차시 ML 개념 |
| `session2_classify` | 2차시 분류 체험 |
| `session2_reflect` | 2차시 성찰일지 |
