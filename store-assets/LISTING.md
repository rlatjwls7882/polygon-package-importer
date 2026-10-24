# Chrome Web Store 등록 정보

등록 양식에 붙여넣기 위한 자료입니다. 스토어에 업로드하거나 심사 제출하지 않은 상태입니다.

## 기본 정보

- 이름: **Polygon ZIP Uploader**
- 주 언어: 한국어
- 카테고리: 개발자 도구(Developer Tools)
- 가격: 무료
- 배포: 공개(Public)
- 홈페이지: https://github.com/rlatjwls7882/polygon-package-importer
- 지원: https://github.com/rlatjwls7882/polygon-package-importer/issues
- 개인정보 처리방침: https://github.com/rlatjwls7882/polygon-package-importer/blob/main/PRIVACY.md
- 아이콘: `store-assets/store-icon-128.png`
- 스크린샷: `store-assets/screenshots/`

## 짧은 설명 (한국어)

컴퓨터에 저장된 Polygon 문제 패키지 ZIP을 Codeforces Polygon에 업로드합니다. 새 문제를 만들거나 기존 문제의 내용을 갱신합니다.

## Short description (English)

Upload local Polygon problem-package ZIP files to Codeforces Polygon. Create new problems or update existing ones.

## 상세 설명 (한국어)

컴퓨터에 저장된 Polygon 문제 패키지 ZIP을 선택해 Codeforces Polygon에 업로드할 수 있습니다. Polygon API로 새 문제를 생성하거나 기존 문제의 파일·지문·테스트를 갱신합니다.

- 로컬 ZIP에서 지문, 소스 코드, 솔루션, 테스트 및 기본 문제 설정 읽기
- 새 문제 생성 또는 기존 문제 ID 지정
- 기존 항목과 동일한 파일·테스트는 재전송하지 않음
- 팝업을 닫아도 업로드 진행, 중단된 작업 재시도
- Polygon API 요청 제한(HTTP 429)에 따른 대기 및 재시도

**사용 조건:** Polygon 계정과 API Key·Secret이 필요합니다. 인증 정보는 Chrome 프로필에 암호화해 저장합니다.

**제한:** 일부 특수 패키지 설정은 완전히 복원되지 않습니다. 컴파일러 버전과 결과를 Polygon에서 확인하세요. 기존 문제 덮어쓰기는 자동 백업과 롤백을 제공하지 않습니다. 중단 시 일부 항목만 변경될 수 있습니다.

Codeforces에서 공식 제공하는 확장 프로그램이 아닙니다.

## Detailed description (English, optional)

Select a Polygon problem-package ZIP from your computer and upload its contents to Codeforces Polygon through the Polygon API. Create a new problem or update an existing problem by ID.

- Import statements, source files, solutions, tests and basic settings
- Skip unchanged files and tests
- Continue uploads when the popup closes
- Retry interrupted imports and handle API rate limits

A Polygon account and API Key/Secret are required. Credentials are encrypted in the local Chrome profile.

Not all package features can be reconstructed exactly. Check compiler settings and uploaded files in Polygon. Existing problem updates have no automatic backup or rollback and may leave partial changes after interruption.

This is an independent, unofficial extension.

## Privacy practices (리뷰어 설명)

**Single purpose:** 사용자가 컴퓨터에서 선택한 Polygon 문제 패키지 ZIP을 Codeforces Polygon API로 새 문제 또는 기존 문제에 업로드합니다.

**권한 사용 목적**

- `storage`: 암호화된 API 인증 정보와 작업 상태를 Chrome 프로필에 저장합니다.
- `offscreen`: 팝업 종료 후에도 ZIP 분석 및 Polygon API 업로드를 계속 수행합니다.
- `https://polygon.codeforces.com/*`: 사용자가 요청한 문제 생성·갱신 작업을 Polygon API로 전송합니다.

**Remote code:** 사용하지 않습니다. 실행 로직은 확장 프로그램 안에 모두 들어 있습니다. 외부 통신은 Polygon API 요청뿐입니다.

**User data:** 인증 정보(API Key·Secret)를 로컬에서 암호화해 저장합니다. 사용자가 선택한 ZIP에 포함된 지문·코드·테스트만 업로드 명령 후 Codeforces Polygon에 전송합니다. 개발자 서버에 전달하거나 판매하지 않습니다.

스토어 대시보드의 사용자 데이터 선언은 업로드 시점의 실제 데이터 처리와 최신 정책에 맞춰 선택하세요. 인증 정보를 취급하므로 '민감한 정보를 처리하지 않음'으로 선언하지 마세요.

## 리뷰어 테스트 안내

1. 확장 프로그램 아이콘을 클릭하고 최초 API 설정 화면을 확인합니다.
2. Polygon 테스트 계정으로 발급한 API Key와 Secret을 입력합니다.
3. 팝업에서 테스트용 ZIP을 선택합니다.
4. 리뷰어가 소유한 테스트 문제에 업로드하거나 새 문제를 생성합니다.
5. Polygon에서 파일·테스트·Checker 등을 확인합니다.

**리뷰어용 테스트 API 계정/키를 제공해야 할 수 있습니다.** 실제 운영 계정의 API Key·Secret은 저장소나 이 파일에 넣지 마세요.

## 등록자가 직접 확인할 항목

- [ ] Chrome 웹스토어 개발자 등록비, 2단계 인증, 개발자 연락처
- [ ] 업로드 전 실제 Chrome + Polygon 계정으로 종단 간 테스트
- [ ] 배포 ZIP, 버전 및 아이콘 확인
- [ ] 개인정보 처리방침 URL 공개 접근 확인
- [ ] 사용자 데이터·권한·원격 코드 선언 확인
- [ ] 필요 시 리뷰어용 테스트 계정/API Key 마련
- [ ] 배포 범위 및 스토어 제출 전 최종 확인
