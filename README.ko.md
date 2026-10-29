# <img src="icons/icon48.png" width="32" height="32" alt=""> Polygon ZIP Uploader

[English](README.md) | [한국어](README.ko.md)

로컬 Polygon 형식의 문제 패키지 ZIP으로 [Codeforces Polygon](https://polygon.codeforces.com)에 새 문제를 만들거나 기존 문제를 갱신합니다.

[![Chrome 웹 스토어에서 설치](https://img.shields.io/badge/Chrome_Web_Store-%EC%84%A4%EC%B9%98-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/polygon-zip-uploader/fhlocfeafcanblbeppffhdilbkblmdcn)

## 사용 방법

1. [Polygon API 설정](https://polygon.codeforces.com/settings)에서 API Key와 Secret을 발급합니다.
2. 확장 프로그램을 열어 키를 저장합니다.
3. `problem.xml`이 포함된 ZIP을 선택합니다. **새 문제**를 선택하거나, **기존 문제**를 선택하고 문제 ID를 입력합니다.
4. **Polygon에 업로드**를 누릅니다.

팝업을 닫아도 업로드는 계속됩니다. 실패한 업로드는 팝업에서 다시 시도할 수 있습니다.

투스텝·인터랙티브 문제와 2차 인터랙티브 실행을 지원합니다. 서브태스크의 점수·채점 정책·의존 관계도 복원합니다.

기본으로 업로드를 커밋한 뒤 Polygon에서 빌드·풀이 실행을 검증합니다. **업로드 완료**와 **빌드·실행 검증 완료**는 구분됩니다. 빌드가 실패해도 커밋은 되돌리지 않으며, 검증 옵션은 끌 수 있습니다.

## 업로드 전 확인

**기존 문제를 갱신하기 전에 백업하세요.** ZIP에 없는 파일·테스트·지문 첨부물이 삭제될 수 있습니다. 자동 백업은 제공하지 않습니다.

ZIP 크기 제한은 **100MB**입니다. 기본 `tests` 테스트셋만 지원하며, 바이너리 파일과 새 지문 이미지는 업로드할 수 없습니다.

[버그 제보](https://github.com/rlatjwls7882/polygon-package-importer/issues) · [개인정보 처리방침](PRIVACY.ko.md) · [개발 안내](CONTRIBUTING.md) · [MIT 라이선스](LICENSE)

Codeforces의 공식 확장 프로그램이 아닙니다.
