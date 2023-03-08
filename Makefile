node: clean
	cd server && nodejs js/main.js

clean:
	rm -f server/output/temp_*

clone_rasm:
	cd server && git clone https://github.com/EdouardBERGE/rasm.git rasm_src
clone_sjasmplus:
	cd server && git clone https://github.com/z00m128/sjasmplus.git

build_sjasmplus:
	cd server/sjasmplus && USE_LUA=0 make
	cp server/sjasmplus/sjasmplus server/bin/sjasmplus.exe


build_rasm:
	cd server/rasm_src && git pull
	cd server/rasm_src && make
	cp server/rasm_src/rasm server/bin/


post_src:
	curl --data-binary @test.asm -X POST http://localhost:8125/test.asm



