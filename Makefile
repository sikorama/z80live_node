
node:
	cd server && nodejs js/main.js

clone_rasm:
	cd server && git clone https://github.com/EdouardBERGE/rasm.git rasm_src
build_rasm:
	cd server/rasm_src && git pull
	cd server/rasm_src && make
	cp server/rasm_src/rasm server/bin/


post_src:
	curl --data-binary @test.asm -X POST http://localhost:8125/test.asm





