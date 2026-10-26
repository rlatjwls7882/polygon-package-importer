# Chrome Web Store 등록·운영 정보

**[Polygon ZIP Uploader — Chrome 웹스토어](https://chromewebstore.google.com/detail/polygon-zip-uploader/fhlocfeafcanblbeppffhdilbkblmdcn)**

2026년 10월 26일 확인 기준으로 **공개 배포 중**이며, 웹스토어에 표시된 버전은 **v0.6.5**입니다. 일반 사용자에게는 웹스토어 설치 링크를 안내하고, 소스 코드 수동 설치는 개발·테스트용으로만 사용합니다.

스토어 설명을 등록하거나 업데이트할 때는 아래 일반 텍스트 파일을 사용합니다. 이 Markdown 문서의 제목이나 강조 기호를 복사하지 마세요.

| 항목 | 한국어 | 영어 |
| --- | --- | --- |
| 짧은 요약 | [summary-ko.txt](summary-ko.txt) | [summary-en.txt](summary-en.txt) |
| 상세 설명 | [description-ko.txt](description-ko.txt) | [description-en.txt](description-en.txt) |

상세 설명 파일에는 Markdown, HTML, 이모지 장식, 반복 키워드를 사용하지 않았습니다. 줄바꿈과 일반 텍스트 항목으로 작성했습니다.

## 등록 정보

- 이름: Polygon ZIP Uploader
- 공개 페이지: https://chromewebstore.google.com/detail/polygon-zip-uploader/fhlocfeafcanblbeppffhdilbkblmdcn
- 카테고리: 개발자 도구(Developer Tools)
- 가격: 무료
- GitHub: https://github.com/rlatjwls7882/polygon-package-importer
- 지원: https://github.com/rlatjwls7882/polygon-package-importer/issues
- 개인정보 처리방침: https://github.com/rlatjwls7882/polygon-package-importer/blob/main/PRIVACY.md
- 아이콘: [store-icon-128.png](store-icon-128.png)
- 스크린샷: [screenshots/01-popup.png](screenshots/01-popup.png)
- 확장 프로그램 배포 ZIP: `python tests/build_release.py`로 생성한 `dist/polygon-zip-uploader-v<version>.zip` (업데이트할 버전으로 빌드)

현재 확장 프로그램 v0.6.5는 API 키 등록·관리와 업로드를 하나의 한국어 팝업에서 제공합니다. 영어 텍스트는 추후 영어 로케일 지원을 위한 초안입니다. Chrome 웹스토어에서 언어별 상세 설명을 별도로 노출하려면 확장 프로그램의 로케일 설정(`_locales/en`, `_locales/ko` 및 `default_locale`)과 스토어 등록 언어가 일치해야 합니다. 현재 버전에 다국어 UI가 구현되어 있다고 표시하지 마세요.

## 문구 검수 기준

- 로컬 ZIP을 통째로 서버에 저장하는 API가 아니라, ZIP의 구성요소를 읽어 Polygon API로 문제에 반영합니다.
- 단일 문제 ZIP과 기본 `tests` 테스트셋을 지원하며 모든 패키지 설정을 완전히 복원한다고 주장하지 않습니다.
- 팝업을 닫아도 업로드를 이어갈 수 있지만, 브라우저 종료 등으로 중단될 수 있습니다.
- 기존 문제 갱신 시 ZIP에 없는 항목이 삭제될 수 있고 자동 백업 및 롤백은 없습니다.
- Polygon 계정과 API Key·Secret이 필요합니다.
- Codeforces의 공식 확장 프로그램이 아니며, 제휴·후원을 받았다는 인상을 주지 않습니다.
- 새 버전 제출 전 실제 Chrome과 Polygon 테스트 계정에서 ZIP 업로드를 종단 간 검증해야 합니다.

## 심사 항목에 사용할 목적과 권한 설명

전용 목적: 컴퓨터에서 선택한 단일 Polygon 문제 패키지 ZIP을 분석하고, Codeforces Polygon API를 통해 새 문제를 생성하거나 사용자가 편집할 수 있는 기존 문제를 갱신합니다.

storage: 사용자가 입력한 Polygon API Key와 Secret을 암호화해 Chrome 프로필에 저장하고, 가져오기 진행 상태와 최근 로그를 보관하기 위해 사용합니다.

offscreen: 팝업이 닫혀도 ZIP을 분석하고 Polygon API 업로드를 수행하기 위해 Offscreen Document를 사용합니다.

polygon.codeforces.com 호스트: 사용자가 요청한 문제의 조회·생성·갱신 및 결과 확인을 위해 해당 Polygon API에만 접근합니다. 다른 사이트의 웹페이지 내용이나 방문 기록을 읽기 위한 권한이 아닙니다.

원격 코드: 사용하지 않습니다. 확장 프로그램의 스크립트는 배포 ZIP에 포함되어 있습니다. Polygon API로 데이터 요청을 보내는 것과 원격 JavaScript를 실행하는 것은 다릅니다.

사용자 데이터: Polygon API Key·Secret을 로컬에 암호화해 저장하고, 사용자가 선택한 ZIP 내용과 필요한 문제 정보를 Polygon API로 전송합니다. 개발자 자체 서버나 광고·추적 서비스로는 전송하지 않습니다. 개인정보 처리방침과 실제 구현을 기준으로 대시보드의 데이터 범주를 신고하세요.

## 다음 버전 업데이트 확인

- [ ] `manifest.json` 버전을 높이고 CI 및 배포 검사(`python tests/check_listing.py`, `python tests/build_release.py`, `python tests/check_release.py`) 통과
- [ ] Chrome에서 실제 Polygon 테스트 계정으로 새 문제 생성·기존 문제 갱신 검증
- [ ] UI가 바뀌었다면 스토어 스크린샷을 갱신하고, 설명·지원 범위가 실제 기능과 일치하는지 확인
- [ ] 개인정보 처리방침·지원 URL·개발자 연락처·데이터 사용 및 권한 설명 최신 상태 유지
- [ ] Chrome 웹스토어 개발자 대시보드에서 새 배포 ZIP 제출
- [ ] 게시 완료 후 공개 페이지의 버전과 설치 동작 확인
- [ ] 테스트용 API Key·Secret 또는 운영 인증 정보를 저장소·심사 자료에 포함하지 않기

관련 정책: https://developer.chrome.com/docs/webstore/program-policies/listing-requirements
