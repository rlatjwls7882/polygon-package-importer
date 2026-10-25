# Polygon ZIP Uploader

컴퓨터에 저장된 Polygon 문제 패키지 ZIP을 Codeforces Polygon에 직접 업로드하는 Chrome 확장 프로그램입니다. 새 문제를 생성하거나 기존 문제의 파일·지문·테스트를 갱신할 수 있습니다.

- 별도 설정 페이지 없이 팝업에서 API 키 등록·변경·삭제 및 ZIP 업로드
- ZIP의 지문, 소스, 솔루션, Checker, Validator 및 테스트 복원
- 기존 메인 솔루션과 이름이 다른 새 MCS도 태그 충돌 없이 교체
- 기존 내용과 비교해 변경된 항목만 전송
- 기존 문제 덮어쓰기에서 지문 이미지 등 이전 Statement Resources 전부 삭제
- 팝업을 닫아도 업로드 진행, 중단된 작업 재시도 (새로 만든 문제는 동일한 ID로 이어서 업로드)
- 기본 API 요청 간격을 3.2초에서 1.2초로 단축하고 요청 제한이 발생하면 자동으로 감속
- 불필요한 기존 테스트는 일괄 삭제해 API 호출 수 절약
- HTTP 429 요청 제한에 대한 대기 및 재시도

## 설치

1. 저장소를 다운로드하거나 복제합니다.
2. Chrome에서 `chrome://extensions`를 열고 **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**를 누릅니다.
4. `manifest.json`이 있는 폴더를 선택합니다.

업데이트 후에는 확장 프로그램을 새로고침하세요.

## 사용법

1. 확장 프로그램 아이콘을 누릅니다. Key가 없다면 팝업에서 [Polygon API 설정](https://polygon.codeforces.com/settings)에서 발급받은 Key와 Secret을 등록합니다. 이미 등록했다면 업로드 화면이 바로 나타납니다.
2. 팝업에서 Polygon 패키지 ZIP을 선택합니다.
3. **새 문제** 또는 **기존 문제**를 선택합니다. 기존 문제를 변경하려면 문제 ID를 입력합니다.
4. 필요하면 **완료 후 커밋**을 해제하고 **Polygon에 업로드**를 누릅니다.

업로드 상태는 팝업을 다시 열어 확인할 수 있습니다. 중단된 작업은 **다시 시도**로 이어서 동기화합니다.

등록된 키는 팝업 오른쪽 위 **API 키**에서 변경하거나 삭제합니다. v0.3.x에서 저장한 API 키가 있다면 같은 팝업에서 기존 보관함 암호를 한 번 입력해 이전할 수 있습니다.

## 지원 범위 및 주의 사항

- `problem.xml`이 포함된 Polygon 패키지와 기본 `tests` 테스트셋 한 개를 지원합니다.
- 수동 테스트, 일부 생성 스크립트, 기본 테스트 그룹과 점수 설정을 지원합니다.
- 패키지에 따라 특수 설정을 완전히 복원하지 못할 수 있습니다. C++ 컴파일러 버전은 업로드 후 Polygon에서 확인하세요.
- 기존 문제에 없는 항목을 추가하고, ZIP에 없는 기존 항목은 삭제할 수 있습니다. 지문에 첨부된 기존 이미지·스타일 파일도 모두 삭제합니다. **자동 백업·롤백은 제공하지 않습니다.**
- ZIP의 지문 이미지/바이너리 첨부물 업로드는 아직 지원하지 않습니다. 패키지에서 이런 항목이 감지되면 업로드 전에 중단합니다.
- 업로드는 여러 API 요청으로 진행됩니다. 실패 시 일부 변경이 작업 사본에 남을 수 있습니다.
- 파일 크기 제한은 100MB입니다.

## API 키 저장

API Key와 Secret은 AES-256-GCM으로 암호화해 Chrome 로컬 저장소에 보관합니다. 복호화 키는 확장 프로그램의 IndexedDB에 저장하며 다른 기기로 동기화하지 않습니다.

같은 브라우저 프로필에서는 자동으로 사용할 수 있으므로 공용 PC에서의 사용은 권장하지 않습니다. 키 변경·삭제도 팝업에서 처리합니다. 자세한 내용은 [개인정보 처리방침](PRIVACY.md)을 참고하세요.

## 개발

Node.js 22 이상과 Python 3이 필요합니다.

```bash
python tests/run_logic.py
node tests/test_main_solution.mjs
node tests/test_background.mjs
node tests/test_api_rate.mjs
node tests/test_batch_deletion.mjs
node tests/test_credential_store.mjs
node tests/test_credential_ui.mjs
node tests/test_storage_errors.mjs
```

실제 ZIP의 로컬 분석과 모의 동기화 테스트:

```bash
python tests/run_real_package.py "path/to/problem.zip"
```

배포 ZIP 생성 및 검사:

```bash
python tests/build_release.py
python tests/check_release.py
```

결과물은 `dist/`에 생성됩니다. 테스트는 실제 Polygon 문제를 수정하지 않습니다.

스토어 등록용 설명과 이미지 파일은 [store-assets/LISTING.md](store-assets/LISTING.md)에 정리해 뒀습니다.

## 권한

| 권한 | 용도 |
| --- | --- |
| `storage` | API 키 및 작업 상태 저장 |
| `offscreen` | 팝업이 닫혀도 업로드 실행 |
| `polygon.codeforces.com` | Polygon API 호출 |

[Polygon API 문서](https://github.com/Codeforces/polygon-misc/blob/main/API.md)

이 확장 프로그램은 Codeforces의 공식 제품이 아닙니다.

## 라이선스

[MIT License](LICENSE)
