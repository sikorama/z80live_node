FROM node:9-alpine

RUN apk update && apk add make gcc g++ tzdata libc-dev
#  tzdata \
#  make

#RUN echo "Europe/Paris" > /etc/timezone
#RUN dpkg-reconfigure -f noninteractive tzdata

RUN npm install
# --only=production

#Rebuild RASM
WORKDIR /usr/src/app/
COPY server/ .

#Compile assemblers
RUN make -C /usr/src/app/asm_src/rasm
RUN cp /usr/src/app/asm_src/rasm/rasm.exe /usr/src/app/bin/rasm

RUN USE_LUA=0 make -C /usr/src/app/asm_src/sjasmplus
RUN cp /usr/src/app/asm_src/sjasmplus/sjasmplus /usr/src/app/bin/sjasmplus


RUN apk del gcc libc-dev 
EXPOSE 8125

WORKDIR /usr/src/app/server/
CMD [ "node" ,"js/main.js" ]
