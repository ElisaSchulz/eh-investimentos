Attribute VB_Name = "ImportarDadosEH"
Option Explicit

'==============================================================================
' IMPORTAR DADOS EH
' Le o arquivo atualizacao_dados_<mes>_<ano>.xlsx (gerado pela tarefa mensal
' dados_planilha.py) e cola cada valor na planilha base Dados_EH_Investimentos,
' sem mudar a estrutura dela:
'   - aba Dados: pela coluna fixa de cada bloco (CDI em N, PTAX em R, ...)
'   - aba Cotas: pela coluna cujo CNPJ ou ticker esta na linha 2
'   - a linha e encontrada pela data; data nova depois da ultima vira linha nova
'
' Regras para nao estragar dado bom:
'   - celula vazia ou com erro: recebe o valor
'   - formula que puxa de outra celula ou de outro arquivo (ex.: =C2951,
'     =HLOOKUP([35]...)): recebe o valor se ele for diferente; se for igual,
'     so a formula com vinculo externo e trocada pelo valor (congela o dado)
'   - valor digitado ou conta digitada (ex.: =29885.31/287): nunca e trocado
'     sem perguntar. Se for diferente, vira "conflito" no relatorio.
'
' Antes de mexer, a macro salva uma copia de seguranca da planilha base.
' No fim abre um relatorio (novo arquivo) com o resumo, os conflitos e a
' Conferencia que veio no arquivo de atualizacao. A planilha base NAO e salva:
' confira e salve voce.
'
' Como usar: abra a Dados_EH_Investimentos, deixe ela ativa e rode a macro
' ImportarDadosEH (Alt+F8). O codigo nao usa acentos de proposito.
'==============================================================================

Private Const ABA_IMPORTAR As String = "Importar"
Private Const ABA_CONFERENCIA As String = "Confer" ' prefixo (Conferencia com acento)

Private gBase As Workbook
Private gDatas As Object        ' "aba|colData" -> Dictionary(data serial -> linha)
Private gUltima As Object       ' "aba|colData" -> Array(ultima linha, ultima data)
Private gCabec As Object        ' "aba|linha" -> Dictionary(chave -> coluna)
Private gSobrescrever As Boolean

Private gNovos As Long, gIguais As Long, gFormulas As Long, gCongelados As Long
Private gSobrescritos As Long, gLinhasNovas As Long
Private gConflitos As Collection, gProblemas As Collection, gPorBloco As Object

Public Sub ImportarDadosEH()
    Dim arquivo As Variant, upd As Workbook, dados As Variant, resp As VbMsgBoxResult
    Dim calcAntes As XlCalculation, i As Long

    Set gBase = ActiveWorkbook
    If Not TemAba(gBase, "Dados") Or Not TemAba(gBase, "Cotas") Then
        MsgBox "Deixe a planilha Dados_EH_Investimentos ativa antes de rodar a macro " & _
               "(ela precisa ter as abas Dados e Cotas).", vbExclamation, "Importar dados EH"
        Exit Sub
    End If

    arquivo = Application.GetOpenFilename("Arquivo de atualizacao (*.xlsx),*.xlsx", , _
                                          "Escolha o arquivo atualizacao_dados_...xlsx")
    If VarType(arquivo) = vbBoolean Then Exit Sub

    SalvarBackup

    resp = MsgBox("Quando um valor DIGITADO na planilha for diferente do valor coletado, " & _
                  "trocar pelo coletado?" & vbCrLf & vbCrLf & _
                  "Nao (recomendado): mantem o seu e lista no relatorio." & vbCrLf & _
                  "Sim: troca e lista no relatorio.", vbYesNoCancel + vbDefaultButton2 + vbQuestion, _
                  "Importar dados EH")
    If resp = vbCancel Then Exit Sub
    gSobrescrever = (resp = vbYes)

    calcAntes = Application.Calculation
    Application.ScreenUpdating = False
    Application.EnableEvents = False
    On Error GoTo Falha

    Set upd = Workbooks.Open(CStr(arquivo), UpdateLinks:=0, ReadOnly:=True)
    If Not TemAba(upd, ABA_IMPORTAR) Then
        upd.Close SaveChanges:=False
        Err.Raise vbObjectError + 1, , "O arquivo escolhido nao tem a aba Importar."
    End If
    dados = upd.Worksheets(ABA_IMPORTAR).UsedRange.Value2
    gBase.Activate
    Application.Calculation = xlCalculationManual

    Inicializar
    PrepararDatas dados
    For i = 2 To UBound(dados, 1)
        If Not IsEmpty(dados(i, 1)) Then GravarLinha dados, i
    Next i

    Application.Calculation = calcAntes
    GerarRelatorio upd, CStr(arquivo)
    upd.Close SaveChanges:=False

    Application.ScreenUpdating = True
    Application.EnableEvents = True
    MsgBox "Pronto." & vbCrLf & _
           gNovos & " valores novos, " & gLinhasNovas & " linhas (datas) novas" & vbCrLf & _
           gFormulas & " formulas trocadas por valor coletado" & vbCrLf & _
           gCongelados & " formulas com vinculo externo congeladas (mesmo valor)" & vbCrLf & _
           gIguais & " ja estavam iguais" & vbCrLf & _
           gConflitos.Count & " conflitos (valor digitado diferente)" & _
           IIf(gSobrescrever, ", trocados", ", mantidos") & vbCrLf & _
           gProblemas.Count & " avisos" & vbCrLf & vbCrLf & _
           "Confira o relatorio e salve a planilha base.", vbInformation, "Importar dados EH"
    Exit Sub

Falha:
    Application.Calculation = calcAntes
    Application.ScreenUpdating = True
    Application.EnableEvents = True
    MsgBox "Erro: " & Err.Description, vbCritical, "Importar dados EH"
End Sub

'------------------------------------------------------------------------------
Private Sub Inicializar()
    Set gDatas = CreateObject("Scripting.Dictionary")
    Set gUltima = CreateObject("Scripting.Dictionary")
    Set gCabec = CreateObject("Scripting.Dictionary")
    Set gPorBloco = CreateObject("Scripting.Dictionary")
    Set gConflitos = New Collection
    Set gProblemas = New Collection
    gNovos = 0: gIguais = 0: gFormulas = 0: gCongelados = 0: gSobrescritos = 0: gLinhasNovas = 0
End Sub

' Le as datas de cada bloco e cria, em ordem, as linhas das datas novas
Private Sub PrepararDatas(dados As Variant)
    Dim novas As Object, i As Long, chave As String, d As Long, k As Variant
    Dim lista() As Long, n As Long, j As Long, info As Variant, ws As Worksheet, col As Long
    Dim kk As Variant

    Set novas = CreateObject("Scripting.Dictionary")
    For i = 2 To UBound(dados, 1)
        If Not IsEmpty(dados(i, 1)) Then
            chave = CStr(dados(i, 1)) & "|" & CStr(dados(i, 2))
            If Not gDatas.Exists(chave) Then LerDatas CStr(dados(i, 1)), CStr(dados(i, 2))
            d = CLng(Int(dados(i, 5)))
            If Not gDatas(chave).Exists(d) Then
                If Not novas.Exists(chave) Then novas.Add chave, CreateObject("Scripting.Dictionary")
                If Not novas(chave).Exists(d) Then novas(chave).Add d, True
            End If
        End If
    Next i

    For Each k In novas.Keys
        n = novas(k).Count
        ReDim lista(1 To n)
        j = 0
        For Each kk In novas(k).Keys
            j = j + 1: lista(j) = CLng(kk)
        Next kk
        OrdenarLongs lista
        info = gUltima(k)
        Set ws = gBase.Worksheets(Split(k, "|")(0))
        col = ws.Range(Split(k, "|")(1) & "1").Column
        For j = 1 To n
            If lista(j) > info(1) Then
                info(0) = info(0) + 1
                ws.Cells(info(0), col).Value = CDate(lista(j))
                ws.Cells(info(0), col).NumberFormat = ws.Cells(info(0) - 1, col).NumberFormat
                gDatas(k).Add lista(j), info(0)
                info(1) = lista(j)
                gLinhasNovas = gLinhasNovas + 1
            Else
                gProblemas.Add Array(Split(k, "|")(0), Split(k, "|")(1), "", Format(CDate(lista(j)), "dd/mm/yyyy"), _
                    "Data antes da ultima da planilha e que nao existe na coluna de datas: valores dessa data ficaram de fora")
            End If
        Next j
        gUltima(k) = info
    Next k
End Sub

Private Sub LerDatas(aba As String, colData As String)
    Dim ws As Worksheet, col As Long, ultima As Long, v As Variant, i As Long
    Dim mapa As Object, ultLinha As Long, ultData As Long

    Set ws = gBase.Worksheets(aba)
    col = ws.Range(colData & "1").Column
    ultima = ws.Cells(ws.Rows.Count, col).End(xlUp).Row
    v = ws.Range(ws.Cells(1, col), ws.Cells(ultima, col)).Value2
    Set mapa = CreateObject("Scripting.Dictionary")
    For i = 1 To ultima
        If VarType(v(i, 1)) = vbDouble Then
            If v(i, 1) > 20000 And v(i, 1) < 80000 Then   ' parece data (1954 a 2119)
                If Not mapa.Exists(CLng(Int(v(i, 1)))) Then mapa.Add CLng(Int(v(i, 1))), i
                If CLng(Int(v(i, 1))) > ultData Then ultData = CLng(Int(v(i, 1)))
                ultLinha = i
            End If
        End If
    Next i
    gDatas.Add aba & "|" & colData, mapa
    gUltima.Add aba & "|" & colData, Array(ultLinha, ultData)
End Sub

Private Function ColunaDaChave(aba As String, linhaChave As Variant, chave As String) As Long
    Dim ws As Worksheet, k As String, v As Variant, c As Long, mapa As Object, ultCol As Long

    Set ws = gBase.Worksheets(aba)
    If IsEmpty(linhaChave) Or CStr(linhaChave) = "" Then
        ColunaDaChave = ws.Range(chave & "1").Column
        Exit Function
    End If
    k = aba & "|" & CStr(linhaChave)
    If Not gCabec.Exists(k) Then
        Set mapa = CreateObject("Scripting.Dictionary")
        ultCol = ws.Cells(CLng(linhaChave), ws.Columns.Count).End(xlToLeft).Column
        v = ws.Range(ws.Cells(CLng(linhaChave), 1), ws.Cells(CLng(linhaChave), ultCol)).Value2
        For c = 1 To ultCol
            If Not IsError(v(1, c)) Then
                If Trim(CStr(v(1, c))) <> "" Then
                    If Not mapa.Exists(UCase(Trim(CStr(v(1, c))))) Then mapa.Add UCase(Trim(CStr(v(1, c)))), c
                End If
            End If
        Next c
        gCabec.Add k, mapa
    End If
    If gCabec(k).Exists(UCase(Trim(chave))) Then ColunaDaChave = gCabec(k)(UCase(Trim(chave)))
End Function

Private Sub GravarLinha(dados As Variant, i As Long)
    Dim aba As String, colData As String, chave As String, d As Long, novo As Double
    Dim col As Long, lin As Long, cel As Range, antigo As Variant, f As String, bloco As String
    Dim tol As Double

    aba = CStr(dados(i, 1)): colData = CStr(dados(i, 2)): chave = CStr(dados(i, 4))
    d = CLng(Int(dados(i, 5))): novo = CDbl(dados(i, 6))
    tol = 0
    If UBound(dados, 2) >= 8 Then
        If VarType(dados(i, 8)) = vbDouble Then tol = CDbl(dados(i, 8))
    End If
    bloco = aba & " " & chave
    If Not gPorBloco.Exists(bloco) Then gPorBloco.Add bloco, 0

    col = ColunaDaChave(aba, dados(i, 3), chave)
    If col = 0 Then
        If gPorBloco(bloco) = 0 Then gProblemas.Add Array(aba, chave, "", "", _
            "Nao achei esse CNPJ/ticker na linha " & dados(i, 3) & " da aba " & aba & ": inclua a coluna se o ativo for novo")
        gPorBloco(bloco) = -1
        Exit Sub
    End If
    If Not gDatas(aba & "|" & colData).Exists(d) Then Exit Sub   ' ja listado em PrepararDatas
    lin = gDatas(aba & "|" & colData)(d)

    Set cel = gBase.Worksheets(aba).Cells(lin, col)
    antigo = cel.Value2
    If cel.HasFormula Then f = cel.Formula Else f = ""

    If IsEmpty(antigo) Or IsError(antigo) Then
        Escrever cel, novo, lin, col: gNovos = gNovos + 1
    ElseIf f <> "" And Not FormulaDigitada(f) And InStr(LCase(CStr(dados(i, 7))), "informe") = 0 Then
        ' Fonte "CVM informe mensal/quadrimestral" (FIDC, FII, FIP, FIAGRO) nunca troca valor que ja existe: vira conflito
        If Igual(antigo, novo, tol) Then
            If InStr(f, "[") > 0 Then
                cel.Value = novo: gCongelados = gCongelados + 1
            Else
                gIguais = gIguais + 1
            End If
        Else
            cel.Value = novo: gFormulas = gFormulas + 1
        End If
    ElseIf Igual(antigo, novo, tol) Then
        gIguais = gIguais + 1
    Else
        gConflitos.Add Array(aba, cel.Address(False, False), chave, Format(CDate(d), "dd/mm/yyyy"), _
                             IIf(f <> "", f, antigo), novo, CStr(dados(i, 7)))
        If gSobrescrever Then cel.Value = novo: gSobrescritos = gSobrescritos + 1
        Exit Sub
    End If
    gPorBloco(bloco) = gPorBloco(bloco) + 1
End Sub

Private Sub Escrever(cel As Range, valor As Double, lin As Long, col As Long)
    cel.Value = valor
    If lin > 1 Then
        If cel.NumberFormat = "General" Then cel.NumberFormat = cel.Offset(-1, 0).NumberFormat
    End If
End Sub

Private Function Igual(a As Variant, b As Double, Optional tol As Double = 0) As Boolean
    If VarType(a) <> vbDouble Then Exit Function
    Igual = Abs(CDbl(a) - b) <= 0.0000000001 + 0.0000001 * Abs(b) + tol
End Function

' Conta digitada (so numeros e operadores, ex.: =29885.31/287) conta como valor digitado
Private Function FormulaDigitada(f As String) As Boolean
    Dim i As Long, ch As String
    For i = 2 To Len(f)
        ch = Mid$(f, i, 1)
        If Not (ch Like "[0-9.,+*/() ^-]") Then Exit Function
    Next i
    FormulaDigitada = True
End Function

'------------------------------------------------------------------------------
Private Sub GerarRelatorio(upd As Workbook, arquivo As String)
    Dim rel As Workbook, ws As Worksheet, r As Long, item As Variant, k As Variant, sh As Worksheet

    Set rel = Workbooks.Add(xlWBATWorksheet)
    Set ws = rel.Worksheets(1)
    ws.Name = "Resumo"
    ws.Range("A1").Value = "Importacao de dados EH - " & Format(Now, "dd/mm/yyyy hh:nn")
    ws.Range("A1").Font.Bold = True
    ws.Range("A2").Value = "Arquivo: " & arquivo
    ws.Range("A3").Value = "Planilha base: " & gBase.Name
    r = 5
    ws.Cells(r, 1).Resize(1, 2).Value = Array("Valores novos", gNovos): r = r + 1
    ws.Cells(r, 1).Resize(1, 2).Value = Array("Linhas (datas) novas", gLinhasNovas): r = r + 1
    ws.Cells(r, 1).Resize(1, 2).Value = Array("Formulas trocadas por valor coletado", gFormulas): r = r + 1
    ws.Cells(r, 1).Resize(1, 2).Value = Array("Formulas com vinculo externo congeladas", gCongelados): r = r + 1
    ws.Cells(r, 1).Resize(1, 2).Value = Array("Ja estavam iguais", gIguais): r = r + 1
    ws.Cells(r, 1).Resize(1, 2).Value = Array("Conflitos", gConflitos.Count): r = r + 1
    ws.Cells(r, 1).Resize(1, 2).Value = Array("Conflitos sobrescritos", gSobrescritos): r = r + 2

    ws.Cells(r, 1).Resize(1, 7).Value = Array("Aba", "Celula", "Chave", "Data", "Valor na planilha", _
                                              "Valor coletado", "Fonte")
    ws.Cells(r, 1).Resize(1, 7).Font.Bold = True
    ws.Cells(r - 1, 1).Value = "CONFLITOS (valor digitado diferente do coletado)"
    ws.Cells(r - 1, 1).Font.Bold = True
    For Each item In gConflitos
        r = r + 1
        ws.Cells(r, 1).Resize(1, 7).Value = Array(item(0), item(1), item(2), item(3), "'" & CStr(item(4)), item(5), item(6))
    Next item
    r = r + 2
    ws.Cells(r, 1).Value = "AVISOS": ws.Cells(r, 1).Font.Bold = True
    For Each item In gProblemas
        r = r + 1
        ws.Cells(r, 1).Resize(1, 5).Value = Array(item(0), item(1), item(2), item(3), item(4))
    Next item
    r = r + 2
    ws.Cells(r, 1).Value = "VALORES GRAVADOS POR SERIE": ws.Cells(r, 1).Font.Bold = True
    For Each k In gPorBloco.Keys
        If gPorBloco(k) > 0 Then
            r = r + 1
            ws.Cells(r, 1).Resize(1, 2).Value = Array(k, gPorBloco(k))
        End If
    Next k
    ws.Columns("A:G").AutoFit
    If ws.Columns("A").ColumnWidth > 60 Then ws.Columns("A").ColumnWidth = 60

    For Each sh In upd.Worksheets
        If Left$(sh.Name, Len(ABA_CONFERENCIA)) = ABA_CONFERENCIA Then
            sh.Copy After:=rel.Worksheets(rel.Worksheets.Count)
            Exit For
        End If
    Next sh
    rel.Worksheets(1).Activate
End Sub

Private Sub SalvarBackup()
    Dim pasta As String, nome As String
    On Error Resume Next
    pasta = gBase.Path
    If pasta = "" Or LCase$(Left$(pasta, 4)) = "http" Then pasta = Environ$("USERPROFILE") & "\Documents"
    nome = pasta & Application.PathSeparator & "Backup antes da importacao " & _
           Format(Now, "yyyy-mm-dd hh-nn") & " - " & gBase.Name
    gBase.SaveCopyAs nome
    If Err.Number <> 0 Then
        MsgBox "Nao consegui salvar a copia de seguranca (" & Err.Description & ")." & vbCrLf & _
               "Se quiser, clique em Cancelar na proxima pergunta e salve uma copia a mao.", vbExclamation
    End If
    On Error GoTo 0
End Sub

Private Function TemAba(wb As Workbook, nome As String) As Boolean
    Dim sh As Object
    For Each sh In wb.Sheets
        If sh.Name = nome Then TemAba = True: Exit Function
    Next sh
End Function

Private Sub OrdenarLongs(a() As Long)
    Dim i As Long, j As Long, t As Long
    For i = LBound(a) + 1 To UBound(a)
        t = a(i): j = i - 1
        Do While j >= LBound(a)
            If a(j) <= t Then Exit Do
            a(j + 1) = a(j): j = j - 1
        Loop
        a(j + 1) = t
    Next i
End Sub
