# 개인정보 처리방침

최종 갱신: 2026-10-25

Polygon Package Importer는 사용자가 선택한 문제 패키지 ZIP을 Codeforces Polygon에 가져오는 Chrome 확장 프로그램입니다.

## 로컬 저장

- Polygon API Key와 Secret은 AES-256-GCM 암호문으로 `chrome.storage.local`에 저장합니다.
- 복호화용 비추출형 CryptoKey는 확장 프로그램의 IndexedDB에 저장합니다. Chrome 프로필을 다시 열어도 인증 정보를 사용할 수 있습니다.
- 기존 암호화 보관함은 사용자가 암호를 입력했을 때 한 번만 이전하며, 이전 후 기존 암호문을 제거합니다.
- 작업 중 ZIP 파일은 브라우저 IndexedDB에 임시 저장합니다. 성공하면 삭제하며, 오류가 발생하면 재시도를 위해 보관됩니다. 사용자는 팝업에서 작업 기록과 임시 ZIP을 삭제할 수 있습니다.
- 작업 상태와 최근 로그는 `chrome.storage.local`에 보관됩니다. 로그에는 API Key와 Secret을 표시하지 않도록 처리합니다.

## 외부 전송

- 사용자가 가져오기를 실행하면 `https://polygon.codeforces.com`으로 HTTPS API 요청을 전송합니다.
- 요청에는 API Key와 Secret으로 계산한 서명이 포함됩니다. API Secret 원문은 전송하지 않습니다.
- 선택한 ZIP의 지문, 코드, 테스트 및 설정은 가져오기 수행 중 Polygon에 전송됩니다.
- 확장 프로그램 개발자가 운영하는 별도 서버, 광고 SDK 또는 사용량 추적 서비스는 사용하지 않습니다.

## 삭제 및 보관

- 설정 페이지에서 **등록 정보 삭제**를 선택하면 로컬 인증 암호문과 복호화 키를 제거합니다.
- 팝업에서 **지우기**를 선택하면 완료·오류 작업 기록과 보관된 ZIP을 삭제합니다. 진행 중 작업은 삭제할 수 없습니다.
- Chrome 확장 프로그램을 제거하면 해당 확장 프로그램의 브라우저 저장소가 삭제됩니다.
- 이미 Polygon에 업로드된 문제는 로컬 저장소를 삭제해도 Polygon 서버에서 삭제되지 않습니다.

## 보안상의 한계

확장 프로그램은 브라우저를 다시 열었을 때도 사용하기 위해 로컬 복호화 키를 보관합니다. 비추출형 키는 일반적인 키 내보내기를 막지만, 같은 브라우저 프로필에서 동작하는 변조된 확장 프로그램 코드나 브라우저 프로필을 장악한 공격자로부터 완전히 보호하지는 못합니다.

## 권한

- `storage`: 인증 정보와 작업 상태 저장
- `offscreen`: 사용자에게 새 탭을 띄우지 않고 XML 파싱 및 긴 업로드 진행
- `https://polygon.codeforces.com/*`: Polygon API 접근

Polygon Package Importer는 Codeforces에서 공식 제공하는 제품이 아닙니다.

Chrome 웹스토어 게시 전에는 개발자 연락처 및 이 방침의 공개 URL을 확정해야 합니다. [Chrome 웹스토어 사용자 데이터 정책](https://developer.chrome.com/docs/webstore/user_data)을 준수합니다.
