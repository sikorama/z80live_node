FROM node:9-alpine

RUN apk update && apk add make gcc tzdata libc-dev
#  tzdata \
#  make

#RUN echo "Europe/Paris" > /etc/timezone
#RUN dpkg-reconfigure -f noninteractive tzdata

RUN npm install
# --only=production

#Rebuild RASM
WORKDIR /usr/src/app/
COPY server/ .

RUN make -C /usr/src/app/rasm_src
RUN cp /usr/src/app/rasm_src/rasm.exe /usr/src/app/bin/rasm
RUN apk del gcc libc-dev 
EXPOSE 8125


CMD [ "node" ,"js/main.js" ]
