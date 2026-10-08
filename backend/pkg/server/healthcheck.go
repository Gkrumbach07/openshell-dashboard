package server

import (
	"fmt"
	"net"
	"net/http"
	"time"
)

func CheckHealth(port string) error {
	client := &http.Client{Timeout: time.Second, Transport: &http.Transport{}}
	resp, err := client.Get("http://" + net.JoinHostPort("127.0.0.1", port) + "/api/v1/healthz")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("BFF healthcheck returned %s", resp.Status)
	}
	return nil
}
